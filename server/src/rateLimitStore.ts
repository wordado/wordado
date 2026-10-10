import type { Db } from './db/db'

/** Better Auth's `rateLimit` table (migrations/0001_init.sql): its own storage keeps the request's address in `key`. */
interface RateLimitRow {
  readonly count: number
  readonly lastRequest: string | number
}

async function keyedHash(secret: string, text: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`ratelimit:${text}`)))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Better Auth's request limiter keys each window by the request's address and
 * path, and its database storage writes that key as it is. This storage keeps
 * the same table and the same windows, but writes a hash keyed with the
 * server's secret instead (#166), as src/feedback/limit.ts does for feedback:
 * no plain address is stored, and the hash cannot be turned back into one
 * without the secret. A window starts at its first request and holds for
 * `window` seconds; the request that finds it full is refused with the
 * seconds left.
 */
export function hashedRateLimit(db: Db, secret: string, now: () => number) {
  return {
    async consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean; retryAfter: number | null }> {
      const hashed = await keyedHash(secret, key)
      const at = now()
      const windowMs = rule.window * 1000
      return db.transaction(async (tx) => {
        const [row] = await tx.query<RateLimitRow>('select count, "lastRequest" from "rateLimit" where key = $1 for update', [hashed])
        const started = row === undefined ? null : Number(row.lastRequest)
        if (started === null || at - started >= windowMs) {
          await tx.query(
            `insert into "rateLimit" (id, key, count, "lastRequest") values ($1, $1, 1, $2)
             on conflict (key) do update set count = 1, "lastRequest" = excluded."lastRequest"`,
            [hashed, at],
          )
          return { allowed: true, retryAfter: null }
        }
        if (row!.count >= rule.max) return { allowed: false, retryAfter: Math.ceil((started + windowMs - at) / 1000) }
        await tx.query('update "rateLimit" set count = count + 1 where key = $1', [hashed])
        return { allowed: true, retryAfter: null }
      })
    },
  }
}
