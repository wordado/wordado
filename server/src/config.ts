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
  readonly MIN_PROTOCOL_VERSION?: string
  readonly GOOGLE_CLIENT_ID?: string
  readonly GOOGLE_CLIENT_SECRET?: string
  readonly RESEND_API_KEY?: string
  readonly EMAIL_FROM?: string
  /** Where the daily feedback mail goes (spec §8.12). A secret: an address is never written in the repository. */
  readonly FEEDBACK_EMAIL?: string
  /** What the review app shows to read feedback (`GET /v1/admin/feedback`, spec §8.12). A secret, the same in both deployments; unset closes the route. */
  readonly FEEDBACK_READ_TOKEN?: string
  /** The review app's origin, for the link in the feedback mail. A variable (wrangler.jsonc). */
  readonly REVIEW_APP_URL?: string
  readonly VAPID_PUBLIC_KEY?: string
  readonly VAPID_PRIVATE_KEY?: string
  readonly VAPID_SUBJECT?: string
}

export const DEFAULT_MIN_PROTOCOL_VERSION = 1
/** The shortest `FEEDBACK_READ_TOKEN` the server answers to; a deploy refuses a shorter one (scripts/secretsFile.ts). */
export const MIN_FEEDBACK_READ_TOKEN_LENGTH = 32

/** `REVIEW_APP_URL` as an origin, without a path; null when it is not set. */
function reviewAppUrl(raw: string | undefined): string | null {
  const value = raw?.trim() ?? ''
  if (value === '') return null
  let url: URL | null = null
  try {
    url = new URL(value)
  } catch {
    // Not a URL: refused below.
  }
  if (url === null || !/^https?:$/.test(url.protocol) || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('REVIEW_APP_URL must be an origin, such as https://review.example.com')
  }
  return url.origin
}

export function configFromEnv(env: Env): ServerConfig {
  if (!env.BASE_URL) throw new Error('BASE_URL must be set')
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters')
  // A token too short to be a random one is no token: the route stays closed, and the rest of the app runs.
  const readToken = env.FEEDBACK_READ_TOKEN?.trim() ?? ''
  const min = env.MIN_PROTOCOL_VERSION ? Number(env.MIN_PROTOCOL_VERSION) : DEFAULT_MIN_PROTOCOL_VERSION
  if (!Number.isInteger(min) || min < 1) throw new Error('MIN_PROTOCOL_VERSION must be a positive integer')
  return {
    baseUrl: env.BASE_URL,
    trustedOrigins: (env.TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ''),
    authSecret: env.BETTER_AUTH_SECRET,
    minProtocolVersion: min,
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : null,
    vapid:
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT ?? 'mailto:reminders@wordado.com' }
        : null,
    feedbackEmail: env.FEEDBACK_EMAIL?.trim() || null,
    feedbackReadToken: readToken.length >= MIN_FEEDBACK_READ_TOKEN_LENGTH ? readToken : null,
    reviewAppUrl: reviewAppUrl(env.REVIEW_APP_URL),
  }
}
