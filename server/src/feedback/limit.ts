import type { Queryable } from '../db/db'
import type { ServerDeps } from '../deps'

/** Tuning (spec §15): messages one client may send in an hour, and all clients together in a UTC day. */
export const FEEDBACK_PER_CLIENT_PER_HOUR = 5
export const FEEDBACK_PER_DAY = 200
/** Sends older than this are dropped by the cron: no limit looks further back. */
export const FEEDBACK_SEND_RETENTION_MS = 86_400_000

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
/** Serialises the count and the record, so two requests at once cannot both take the last place. */
const FEEDBACK_LOCK = 7273

const toHex = (buffer: ArrayBuffer): string => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * The client a request came from, for the limit: the address Cloudflare saw
 * (`cf-connecting-ip`, the header Better Auth is told to trust too), as a
 * hash keyed with the server's secret. The address itself is never stored,
 * and the hash cannot be turned back into it without the secret. Requests
 * with no address (local development) count as one client.
 */
export async function feedbackClient(secret: string, address: string | undefined): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(`feedback:${address ?? ''}`)))
}

/**
 * Takes one place in the limits, inside the caller's transaction: false when
 * this client has had its hour's share or the day is full, and then nothing
 * is recorded.
 */
export async function takeFeedbackPlace(tx: Queryable, client: string, now: number): Promise<boolean> {
  const startOfDay = Math.floor(now / DAY_MS) * DAY_MS
  await tx.query('select pg_advisory_xact_lock($1)', [FEEDBACK_LOCK])
  const [counts] = await tx.query<{ client: number; day: number }>(
    `select count(*) filter (where client = $1 and sent_at > $2)::int as client, count(*) filter (where sent_at >= $3)::int as day
     from feedback_send where sent_at >= $4`,
    [client, now - HOUR_MS, startOfDay, Math.min(now - HOUR_MS, startOfDay)],
  )
  if (!counts || counts.client >= FEEDBACK_PER_CLIENT_PER_HOUR || counts.day >= FEEDBACK_PER_DAY) return false
  await tx.query('insert into feedback_send (client, sent_at) values ($1, $2)', [client, now])
  return true
}

/** The cron's step: sends a day old are no longer needed by either limit. */
export async function pruneFeedbackSends(deps: ServerDeps): Promise<number> {
  const rows = await deps.db.query('delete from feedback_send where sent_at < $1 returning id', [deps.now() - FEEDBACK_SEND_RETENTION_MS])
  return rows.length
}
