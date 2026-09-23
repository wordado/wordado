import type { Job, ServerConfig } from './deps'

/**
 * The Worker's bindings and variables (server/wrangler.jsonc; secrets from
 * server/.dev.vars locally, from the deploy in plan 7). Written by hand: only
 * what the server reads.
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
  readonly VAPID_PUBLIC_KEY?: string
  readonly VAPID_PRIVATE_KEY?: string
  readonly VAPID_SUBJECT?: string
}

export const DEFAULT_MIN_PROTOCOL_VERSION = 1

export function configFromEnv(env: Env): ServerConfig {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters')
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
  }
}
