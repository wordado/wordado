import type { MiddlewareHandler } from 'hono'
import type { ServerDeps } from './deps'
import type { AppEnv } from './http'

/** Tuning (spec §15): codes one address may be sent in an hour, and all addresses together in a UTC day (spec §17.2: the free email allowance is 100 a day). */
export const CODE_SENDS_PER_ADDRESS_PER_HOUR = 3
export const CODE_SENDS_PER_DAY = 100
/** Code sends and Better Auth's rate-limit rows older than this are dropped by the cron. */
export const SIGN_IN_LIMIT_RETENTION_MS = 86_400_000

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
/** Serialises the count and the record, so two requests at once cannot both take the last send. */
const SEND_LOCK = 7272

async function emailOf(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.clone().json()
    const email = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['email'] : undefined
    // Better Auth lower-cases the address before it sends; count it the same way.
    return typeof email === 'string' ? email.trim().toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * In front of Better Auth's send-verification-otp (spec §8.6, §17.2). Better
 * Auth limits requests per IP; this limits emails, per address and in all, so
 * one visitor with many IPs cannot use up the day's allowance unseen, and a
 * learner who is refused learns why. A send is recorded before Better Auth
 * runs and taken back if it did not answer 200, since only then was a code
 * sent.
 */
export function signInEmailLimit(deps: ServerDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const email = await emailOf(c.req.raw)
    // Nothing to count: Better Auth refuses the request itself.
    if (email === null) return next()
    const now = deps.now()
    const startOfDay = Math.floor(now / DAY_MS) * DAY_MS
    const id = await deps.db.transaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock($1)', [SEND_LOCK])
      const [counts] = await tx.query<{ address: number; day: number }>(
        `select count(*) filter (where email = $1 and sent_at > $2)::int as address, count(*) filter (where sent_at >= $3)::int as day
         from sign_in_code_send where sent_at >= $4`,
        [email, now - HOUR_MS, startOfDay, Math.min(now - HOUR_MS, startOfDay)],
      )
      if (!counts || counts.address >= CODE_SENDS_PER_ADDRESS_PER_HOUR || counts.day >= CODE_SENDS_PER_DAY) return null
      const [row] = await tx.query<{ id: number }>('insert into sign_in_code_send (email, sent_at) values ($1, $2) returning id', [email, now])
      return row?.id ?? null
    })
    if (id === null) return c.json({ error: 'sign_in_email_limit' }, 429)
    await next()
    if (c.res.status !== 200) await deps.db.query('delete from sign_in_code_send where id = $1', [id])
  }
}

/** The cron's step: code sends and Better Auth's rate-limit rows a day old are no longer needed by any limit. */
export async function pruneSignInLimits(deps: ServerDeps): Promise<{ codeSends: number; rateLimits: number }> {
  const before = deps.now() - SIGN_IN_LIMIT_RETENTION_MS
  const codeSends = await deps.db.query('delete from sign_in_code_send where sent_at < $1 returning id', [before])
  const rateLimits = await deps.db.query('delete from "rateLimit" where "lastRequest" < $1 returning id', [before])
  return { codeSends: codeSends.length, rateLimits: rateLimits.length }
}
