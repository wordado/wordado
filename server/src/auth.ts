import { betterAuth } from 'better-auth'
import { emailOTP } from 'better-auth/plugins/email-otp'
import type { ServerDeps } from './deps'
import { hashedRateLimit } from './rateLimitStore'

/** Tuning (spec §15). */
export const SESSION_DAYS = 60
export const OTP_SECONDS = 300
export const OTP_SENDS_PER_MINUTE = 3

/**
 * Passwordless sign-in (spec §8.6): a six-digit code by email.
 * The first successful sign-in creates the user; there is no separate
 * sign-up. Sessions last 60 days and are refreshed once a day of use, so a
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

export function createAuth(deps: ServerDeps) {
  const { config } = deps
  return betterAuth({
    database: deps.db.pool,
    secret: config.authSecret,
    baseURL: config.baseUrl,
    basePath: '/api/auth',
    trustedOrigins: [...config.trustedOrigins],
    session: { expiresIn: SESSION_DAYS * 86_400, updateAge: 86_400 },
    account: { updateAccountOnSignIn: false },
    databaseHooks: {
      user: {
        create: { before: async (user) => ({ data: withoutProfile(user) }) },
        update: { before: async (user) => ({ data: withoutProfile(user) }) },
      },
      account: {
        create: { before: async (account) => ({ data: withoutTokens(account) }) },
        update: { before: async (account) => ({ data: withoutTokens(account) }) },
      },
      session: {
        create: { before: async (session) => ({ data: withoutDevice(session) }) },
        update: { before: async (session) => ({ data: withoutDevice(session) }) },
      },
    },
    rateLimit: {
      enabled: true,
      // Per-isolate memory would not limit anything on Workers; the database, with the keys hashed (#166).
      customStorage: hashedRateLimit(deps.db, config.authSecret, deps.now),
      customRules: { '/email-otp/send-verification-otp': { window: 60, max: OTP_SENDS_PER_MINUTE } },
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
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
