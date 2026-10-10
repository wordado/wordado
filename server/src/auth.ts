import { betterAuth } from 'better-auth'
import { emailOTP } from 'better-auth/plugins/email-otp'
import type { ServerDeps } from './deps'

/** Tuning (spec §15). */
export const SESSION_DAYS = 60
export const OTP_SECONDS = 300
export const OTP_SENDS_PER_MINUTE = 3

/**
 * Passwordless sign-in (spec §8.6): a six-digit code by email, or Google.
 * The first successful sign-in creates the user; there is no separate
 * sign-up. Sessions last 60 days and are refreshed once a day of use, so a
 * returning learner is not asked for a code again — which also keeps email
 * volume inside the provider's daily allowance (spec §17).
 */
/**
 * Nothing from Google sign-in that the app does not use (#163). Better Auth copies the name and the picture
 * of the Google profile into `user` and keeps the tokens for calling Google in `account`; no screen shows
 * the former and nothing calls Google, so none of it is stored. The hooks run on every write, so a learner
 * cannot set a name through update-user either, and a later Google sign-in does not bring the tokens back.
 */
export const withoutProfile = <T extends object>(user: T): T => ({ ...user, name: '', image: null })
export const withoutTokens = <T extends object>(account: T): T => ({
  ...account, accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null, scope: null,
})

export function createAuth(deps: ServerDeps) {
  const { config } = deps
  return betterAuth({
    database: deps.db.pool,
    secret: config.authSecret,
    baseURL: config.baseUrl,
    basePath: '/api/auth',
    trustedOrigins: [...config.trustedOrigins],
    // Only the country is kept from the age gate (spec §11); the client sets it through update-user.
    user: { additionalFields: { country: { type: 'string', required: false, input: true } } },
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
    },
    socialProviders: config.google
      ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret } }
      : {},
    rateLimit: {
      enabled: true,
      // Per-isolate memory would not limit anything on Workers.
      storage: 'database',
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
