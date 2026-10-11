import { FEEDBACK_KINDS, type FeedbackItem, type FeedbackKind, type FeedbackPage } from '@wordado/core'
import type { Hono } from 'hono'
import { hasBearerToken } from '../adminToken'
import type { ServerDeps } from '../deps'
import { invalid, type AppEnv } from '../http'

/** Tuning (spec §15): the messages one page holds when the caller names no size, and the most it may ask for. */
export const FEEDBACK_PAGE_DEFAULT = 50
export const FEEDBACK_PAGE_MAX = 100

interface FeedbackRow {
  readonly id: number
  readonly signed_in: boolean
  readonly kind: FeedbackKind
  readonly message: string
  readonly contact_email: string
  readonly app_version: string
  readonly corpus_version: string
  readonly user_agent: string
  readonly language: string
  readonly screen: string
  readonly received_at: number
}

/** The token that reads feedback, compared as every token here is (src/adminToken.ts). */
export const hasReadToken = hasBearerToken

/** A whole number from 1 up in a query, `fallback` when the query has none, null when it is anything else. */
function positive(raw: string | undefined, fallback: number | null): number | null {
  if (raw === undefined) return fallback
  return /^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : null
}

/** `ids` in a query: 1 to 100 message ids with commas between, null when it is anything else. */
function idList(raw: string): number[] | null {
  return /^[1-9]\d{0,14}(,[1-9]\d{0,14}){0,99}$/.test(raw) ? raw.split(',').map(Number) : null
}

export function feedbackAdminRoutes(app: Hono<AppEnv>, deps: ServerDeps): void {
  /**
   * The feedback, for the review app's Feedback tab (spec §8.12): newest
   * first, in pages. It answers only to the shared token
   * (`FEEDBACK_READ_TOKEN`); without the secret, or to a request without the
   * token, it is a route that does not exist. Read-only, and the account
   * behind a message is never given, only whether there was one. The caller
   * is a server, so nothing here reads a cookie or answers CORS. With `ids`
   * it gives those messages alone, as the review app asks for the messages
   * of a topic; an id it does not have is simply not there.
   */
  app.get('/v1/admin/feedback', async (c) => {
    const token = deps.config.feedbackReadToken
    if (token === null || !(await hasReadToken(token, c.req.header('authorization')))) return c.notFound()
    const limit = positive(c.req.query('limit'), FEEDBACK_PAGE_DEFAULT)
    const before = positive(c.req.query('before'), null)
    const since = c.req.query('since') === undefined ? 0 : positive(c.req.query('since'), null)
    const kind = c.req.query('kind')
    const ids = c.req.query('ids') === undefined ? null : idList(c.req.query('ids')!)
    const errors: string[] = []
    if (limit === null || limit > FEEDBACK_PAGE_MAX) errors.push(`limit must be a whole number from 1 to ${FEEDBACK_PAGE_MAX}`)
    if (c.req.query('before') !== undefined && before === null) errors.push('before must be the id of a message')
    if (since === null) errors.push('since must be a time in epoch milliseconds')
    if (c.req.query('ids') !== undefined && ids === null) errors.push('ids must be 1 to 100 message ids')
    if (kind !== undefined && !(FEEDBACK_KINDS as readonly string[]).includes(kind)) errors.push(`kind must be one of ${FEEDBACK_KINDS.join(', ')}`)
    if (errors.length > 0 || limit === null || since === null) return invalid(c, errors)
    // One more than the page, to know whether an older one follows.
    const rows = await deps.db.query<FeedbackRow>(
      `select id, signed_in, kind, message, contact_email, app_version, corpus_version, user_agent, language, screen, received_at
       from feedback
       where ($1::bigint is null or id < $1) and ($2::text is null or kind = $2) and received_at >= $3
         and ($5::bigint[] is null or id = any($5))
       order by id desc limit $4`,
      [before, kind ?? null, since, limit + 1, ids],
    )
    const items: FeedbackItem[] = rows.slice(0, limit).map((row) => ({
      id: row.id,
      receivedAt: row.received_at,
      kind: row.kind,
      message: row.message,
      contactEmail: row.contact_email,
      signedIn: row.signed_in,
      appVersion: row.app_version,
      corpusVersion: row.corpus_version,
      language: row.language,
      screen: row.screen,
      userAgent: row.user_agent,
    }))
    const page: FeedbackPage = { items, nextBefore: rows.length > limit ? (items.at(-1)?.id ?? null) : null }
    c.header('cache-control', 'no-store')
    return c.json(page)
  })
}
