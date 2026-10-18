import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { recordSignIn } from './account/lastSignIn'
import type { ServerConfig, ServerDeps } from './deps'
import { hashedRateLimit } from './rateLimitStore'
import { refuseAccountWithoutAge, signUpAfterAge } from './signUp'

/** Tuning (spec §15). */
export const SESSION_DAYS = 60
export const OTP_SECONDS = 300
export const OTP_SENDS_PER_MINUTE = 3
export const PASSKEY_SIGN_INS_PER_MINUTE = 10
export const PASSKEY_REGISTRATIONS_PER_MINUTE = 5

/**
 * Passwordless sign-in (spec §8.6): a six-digit code by email.
 * A right code for an address with an account signs in; for one without, the
 * account is created only after the age step (src/signUp.ts, #293). Sessions last 60 days and are refreshed once a day of use, so a
 * returning learner is not asked for a code again — which also keeps email
 * volume inside the provider's daily allowance (spec §17).
 */
/**
 * Nothing the app does not use (#163, #166). Better Auth would store a name and a picture in `user`, the
 * tokens of a linked sign-in in `account`, and the request's address and browser in `session`; no screen shows
 * any of it and nothing calls another service with it. The hooks run on every write, so a learner cannot set a
 * name through update-user either.
 */
export const withoutProfile = <T extends object>(user: T): T => ({ ...user, name: '', image: null })
export const withoutTokens = <T extends object>(account: T): T => ({
  ...account, accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null, scope: null,
})
export const withoutDevice = <T extends object>(session: T): T => ({ ...session, ipAddress: null, userAgent: null })

/**
 * The origins a passkey response may come from: the app's own and the trusted ones (the Vite dev server, locally),
 * never the request's header. Each once: in production the trusted origin is the app's.
 */
export const passkeyOrigins = (config: ServerConfig): string[] => [...new Set([config.baseUrl, ...config.trustedOrigins].map((url) => new URL(url).origin))]

/**
 * A passkey always asks for the device unlock (spec §4). The plugin verifies with `requireUserVerification: false`
 * whatever `authenticatorSelection` says, so these refuse a response without the user-verified flag. The plugin runs
 * them after the signature checks and before it stores a passkey, moves the counter or makes a session.
 */
export const USER_NOT_VERIFIED = 'USER_NOT_VERIFIED'
const unverified = (status: 'BAD_REQUEST' | 'UNAUTHORIZED') =>
  new APIError(status, { code: USER_NOT_VERIFIED, message: 'The device did not verify the learner' })
export const requireUserVerification = {
  registration: ({ verification }: { verification: { registrationInfo?: { userVerified: boolean } | undefined } }): void => {
    if (verification.registrationInfo?.userVerified !== true) throw unverified('BAD_REQUEST')
  },
  authentication: ({ verification }: { verification: { authenticationInfo: { userVerified: boolean } } }): void => {
    if (!verification.authenticationInfo.userVerified) throw unverified('UNAUTHORIZED')
  },
}

/**
 * A passkey (#287) is a second way to sign in, added while signed in and used instead of the emailed code. The
 * server keeps the credential's id, public key and counter; never a name for it nor the authenticator's model,
 * which a trigger blanks (migrations/0013_passkeys.sql). Renaming is off, as there is no name. Every registration and
 * sign-in must carry the device unlock (`requireUserVerification`).
 */
export function createAuth(deps: ServerDeps) {
  const { config } = deps
  return betterAuth({
    database: deps.db.pool,
    secret: config.authSecret,
    baseURL: config.baseUrl,
    basePath: '/api/auth',
    trustedOrigins: [...config.trustedOrigins],
    disabledPaths: ['/passkey/update-passkey'],
    session: { expiresIn: SESSION_DAYS * 86_400, updateAge: 86_400 },
    account: { updateAccountOnSignIn: false },
    databaseHooks: {
      user: {
        // An account is created only by the create-account route, after the age step (#293, src/signUp.ts).
        create: {
          before: async (user, ctx) => {
            await refuseAccountWithoutAge(user, ctx)
            return { data: withoutProfile(user) }
          },
        },
        update: { before: async (user) => ({ data: withoutProfile(user) }) },
      },
      account: {
        create: { before: async (account) => ({ data: withoutTokens(account) }) },
        update: { before: async (account) => ({ data: withoutTokens(account) }) },
      },
      session: {
        // The `after` of each: a sign-in, or a session extended after a day of use, dates the account (#187).
        create: { before: async (session) => ({ data: withoutDevice(session) }), after: async (session) => recordSignIn(deps.db, session?.userId, deps.now()) },
        update: { before: async (session) => ({ data: withoutDevice(session) }), after: async (session) => recordSignIn(deps.db, session?.userId, deps.now()) },
      },
    },
    rateLimit: {
      enabled: true,
      // Per-isolate memory would not limit anything on Workers; the database, with the keys hashed (#166).
      customStorage: hashedRateLimit(deps.db, config.authSecret, deps.now),
      customRules: {
        '/email-otp/send-verification-otp': { window: 60, max: OTP_SENDS_PER_MINUTE },
        '/passkey/generate-authenticate-options': { window: 60, max: PASSKEY_SIGN_INS_PER_MINUTE },
        '/passkey/verify-authentication': { window: 60, max: PASSKEY_SIGN_INS_PER_MINUTE },
        '/passkey/generate-register-options': { window: 60, max: PASSKEY_REGISTRATIONS_PER_MINUTE },
        '/passkey/verify-registration': { window: 60, max: PASSKEY_REGISTRATIONS_PER_MINUTE },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      // The migrations own the schema (migrations/0001_init.sql). Better Auth's own check would run on every
      // request, since the Worker's pool is new each time, and fail once the pool is ended under it.
      database: { validateSchema: false },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: OTP_SECONDS,
        allowedAttempts: 3,
        storeOTP: 'hashed',
        // Not awaited: how long sending takes must not show in the response. A failure
        // cannot reach the learner any more, so it is logged (without the address).
        async sendVerificationOTP({ email, otp }) {
          deps.background(deps.mailer.sendSignInCode(email, otp).catch((error: unknown) => console.error('sign-in code not sent', error)))
        },
      }),
      passkey({
        rpID: config.passkeyRpId,
        rpName: 'Wordado',
        origin: passkeyOrigins(config),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        registration: { afterVerification: requireUserVerification.registration },
        authentication: { afterVerification: requireUserVerification.authentication },
      }),
      signUpAfterAge(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
