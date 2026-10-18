import type { Job, ServerConfig } from './deps'

/**
 * The Worker's bindings and variables (server/wrangler.jsonc; secrets from
 * server/.dev.vars locally, from the deploy's `--secrets-file` (docs/deploy.md)).
 * Written by hand: only what the server reads.
 */
export interface Env {
  readonly HYPERDRIVE: { readonly connectionString: string }
  readonly JOBS: {
    send(body: Job): Promise<void>
    sendBatch(messages: Iterable<{ readonly body: Job }>): Promise<void>
  }
  readonly BASE_URL: string
  readonly BETTER_AUTH_SECRET: string
  /** Comma-separated. */
  readonly TRUSTED_ORIGINS?: string
  /** The relying party id of passkeys (#287), a domain the app's origin is on. Unset, BASE_URL's hostname; set in production to the site's domain. */
  readonly PASSKEY_RP_ID?: string
  readonly MIN_PROTOCOL_VERSION?: string
  readonly RESEND_API_KEY?: string
  readonly EMAIL_FROM?: string
  /** What the review app shows to read feedback (`GET /v1/admin/feedback`, spec §8.12). A secret, the same in both deployments; unset closes the route. */
  readonly FEEDBACK_READ_TOKEN?: string
  /** What the review app shows to look an account up, delete one and read the sweep's counts (`/v1/admin/accounts/*`, #187). A secret, the same in
   * both deployments and not the one above; unset closes the routes. */
  readonly ADMIN_WRITE_TOKEN?: string
  /** The announcement mails sent in one UTC day at most (#185). Unset, DEFAULT_ANNOUNCEMENT_MAILS_PER_DAY; 0 sends none. */
  readonly ANNOUNCEMENT_MAILS_PER_DAY?: string
  readonly VAPID_PUBLIC_KEY?: string
  readonly VAPID_PRIVATE_KEY?: string
  readonly VAPID_SUBJECT?: string
}

export const DEFAULT_MIN_PROTOCOL_VERSION = 1
/** The shortest `FEEDBACK_READ_TOKEN` the server answers to; a deploy refuses a shorter one (scripts/secretsFile.ts). */
export const MIN_FEEDBACK_READ_TOKEN_LENGTH = 32
/** The same for `ADMIN_WRITE_TOKEN`. */
export const MIN_ADMIN_WRITE_TOKEN_LENGTH = 32

/**
 * Half of the 100 mails a day of the mail provider's free plan (resend.com/docs/knowledge-base/account-quotas-and-limits,
 * read 2026-10-11): the allowance is shared with the sign-in codes, which must never be the ones to wait. On a
 * plan without a daily limit, `ANNOUNCEMENT_MAILS_PER_DAY` raises it.
 */
export const DEFAULT_ANNOUNCEMENT_MAILS_PER_DAY = 50

export function configFromEnv(env: Env): ServerConfig {
  if (!env.BASE_URL) throw new Error('BASE_URL must be set')
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters')
  // A token too short to be a random one is no token: the route stays closed, and the rest of the app runs.
  const readToken = env.FEEDBACK_READ_TOKEN?.trim() ?? ''
  // The same for the token that deletes; and one that is also the reading token is none, or reading would delete.
  const writeToken = env.ADMIN_WRITE_TOKEN?.trim() ?? ''
  const min = env.MIN_PROTOCOL_VERSION ? Number(env.MIN_PROTOCOL_VERSION) : DEFAULT_MIN_PROTOCOL_VERSION
  if (!Number.isInteger(min) || min < 1) throw new Error('MIN_PROTOCOL_VERSION must be a positive integer')
  const perDay = env.ANNOUNCEMENT_MAILS_PER_DAY ? Number(env.ANNOUNCEMENT_MAILS_PER_DAY) : DEFAULT_ANNOUNCEMENT_MAILS_PER_DAY
  if (!Number.isInteger(perDay) || perDay < 0) throw new Error('ANNOUNCEMENT_MAILS_PER_DAY must be a whole number, 0 or more')
  return {
    baseUrl: env.BASE_URL,
    trustedOrigins: (env.TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ''),
    authSecret: env.BETTER_AUTH_SECRET,
    passkeyRpId: env.PASSKEY_RP_ID?.trim() || new URL(env.BASE_URL).hostname,
    minProtocolVersion: min,
    vapid:
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT ?? 'mailto:reminders@wordado.com' }
        : null,
    feedbackReadToken: readToken.length >= MIN_FEEDBACK_READ_TOKEN_LENGTH ? readToken : null,
    adminWriteToken: writeToken.length >= MIN_ADMIN_WRITE_TOKEN_LENGTH && writeToken !== readToken ? writeToken : null,
    announcementMailsPerDay: perDay,
  }
}
