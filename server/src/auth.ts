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
    socialProviders: config.google
      ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret } }
      : {},
    rateLimit: {
      enabled: true,
      // Per-isolate memory would not limit anything on Workers.
      storage: 'database',
      customRules: { '/email-otp/send-verification-otp': { window: 60, max: OTP_SENDS_PER_MINUTE } },
    },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: OTP_SECONDS,
        allowedAttempts: 3,
        storeOTP: 'hashed',
        // Not awaited: how long sending takes must not show in the response.
        async sendVerificationOTP({ email, otp }) {
          deps.background(deps.mailer.sendSignInCode(email, otp))
        },
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
