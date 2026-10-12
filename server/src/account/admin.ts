import { ANNOUNCEMENT_LANGUAGES, type AnnouncementLanguage, type NewsConsent } from '@wordado/core'
import type { Hono } from 'hono'
import { requireAdminWriteToken } from '../adminToken'
import { KNOWN_LANGUAGE_OF } from '../announcements/store'
import type { ServerDeps } from '../deps'
import { invalid, readJson, type AppEnv } from '../http'
import { MAX_IGNORED_REMINDERS } from '../reminders/schedule'
import { deleteAccount } from './deletion'
import { accountSeries, accountSplits, accountStats } from './stats'
import { accountSweepStatus, INACTIVE_ACCOUNT_MS } from './sweep'

const DAY_MS = 86_400_000
/** The days the lookup counts study over, today among them, and the most reminders it tells of. */
const STUDY_DAYS = 30
const MAX_REMINDERS = 10

/** The longest address looked for; a longer one is no address. */
const MAX_EMAIL_LENGTH = 320

/** The address in a request's body as an account would have it, or null when the body has none. */
function emailOf(body: unknown): string | null {
  const raw = typeof body === 'object' && body !== null ? (body as { email?: unknown }).email : undefined
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return email.length >= 3 && email.length <= MAX_EMAIL_LENGTH && email.includes('@') ? email : null
}

interface AccountRow {
  readonly id: string
  readonly created_at: Date
  readonly last_sign_in_at: Date | null
  readonly news_consent: NewsConsent
  readonly news_consent_at: Date | null
  readonly news_consent_text: string | null
  readonly language: string | null
}

/** What the lookup says of an account beyond its two dates (#209): how it is used, never what it holds. */
export interface AccountDetails {
  /** When its last answer was given (epoch milliseconds, from the device rows, as the counts read it); null when it never studied. */
  readonly lastStudiedAt: number | null
  /** On how many of the last 30 UTC days, today among them, it gave at least one answer. */
  readonly daysStudied30: number
  /** Its interface language as an announcement reads it (announcements/store.ts): what its app said, else the
   * older signs of one; null when it left none, and an announcement writes to it in English. */
  readonly language: AnnouncementLanguage | null
  /** What it said to news by email, when, and in which language it read the question; the last two null when it said nothing. */
  readonly newsConsent: NewsConsent
  readonly newsConsentAt: number | null
  readonly newsConsentLanguage: AnnouncementLanguage | null
  /** Its reminders, the newest device first: the minute of the day, the device's offset from UTC in minutes, and
   * whether the app stopped sending after reminders were ignored. Empty: reminders are off. */
  readonly reminders: readonly { readonly minute: number; readonly tzOffsetMin: number; readonly paused: boolean }[]
  /** The devices it has synced answers from. */
  readonly devices: number
  /** The earliest moment the sweep of inactive accounts could take it, if it never signs in again; null when it
   * has no date of a last sign-in, since the sweep never takes such an account. */
  readonly sweepNotBefore: number | null
}

/** The language a consent's wording was read in (`news-1.bg`), or null when the text names none this version knows. */
const consentLanguage = (text: string | null): AnnouncementLanguage | null => ANNOUNCEMENT_LANGUAGES.find((l) => text?.endsWith(`.${l}`)) ?? null

/**
 * The provider's own handling of accounts, for the review app's Accounts tab (#187): an erasure asked for by
 * mail, an account closed, the counts of the sweep, and the counts of accounts and their use (#206). The caller
 * is the review app's server, with `ADMIN_WRITE_TOKEN` (src/adminToken.ts) and no cookie. The address travels in
 * the body, never in the path or the query, which are logged. Only the lookup answers about one account, and only
 * for its whole address: when it was made and last signed in, and how it is used (#209). No route lists accounts,
 * and the log has no address and no id.
 */
export function accountAdminRoutes(app: Hono<AppEnv>, deps: ServerDeps): void {
  const admin = requireAdminWriteToken(deps)

  /** The accounts an address names: the whole address, whatever its capitals. More than one cannot be told apart, and is refused. */
  const find = (email: string): Promise<AccountRow[]> =>
    deps.db.query<AccountRow>(
      `select u.id, u."createdAt" as created_at, u.last_sign_in_at, u.news_consent, u.news_consent_at, u.news_consent_text, ${KNOWN_LANGUAGE_OF} as language
       from "user" u where lower(u.email) = $1 limit 2`,
      [email],
    )

  /** Three statements, each one account's rows by an index that begins with it; of the answer log, the last 30 days by `(user_id, utc_day)`. */
  const detailsOf = async (row: AccountRow): Promise<AccountDetails> => {
    const since = Math.floor(deps.now() / DAY_MS) - STUDY_DAYS
    const [[devices], [days], reminders] = await Promise.all([
      deps.db.query<{ devices: number; last_studied: number | null }>('select count(*)::int as devices, max(effective_ts)::int8 as last_studied from device where user_id = $1', [row.id]),
      deps.db.query<{ days: number }>('select count(distinct utc_day)::int as days from review_event where user_id = $1 and utc_day > $2', [row.id, since]),
      deps.db.query<{ reminder_minute: number; tz_offset_min: number; ignored: number }>(
        'select reminder_minute, tz_offset_min, ignored from push_subscription where user_id = $1 order by created_at desc, endpoint limit $2',
        [row.id, MAX_REMINDERS],
      ),
    ])
    return {
      lastStudiedAt: devices?.last_studied ?? null,
      daysStudied30: days?.days ?? 0,
      language: ANNOUNCEMENT_LANGUAGES.find((l) => l === row.language) ?? null,
      newsConsent: row.news_consent,
      newsConsentAt: row.news_consent_at?.getTime() ?? null,
      newsConsentLanguage: row.news_consent === 'none' ? null : consentLanguage(row.news_consent_text),
      reminders: reminders.map((r) => ({ minute: r.reminder_minute, tzOffsetMin: r.tz_offset_min, paused: r.ignored >= MAX_IGNORED_REMINDERS })),
      devices: devices?.devices ?? 0,
      sweepNotBefore: row.last_sign_in_at === null ? null : row.last_sign_in_at.getTime() + INACTIVE_ACCOUNT_MS,
    }
  }

  app.post('/v1/admin/accounts/lookup', admin, async (c) => {
    const email = emailOf(await readJson(c))
    if (email === null) return invalid(c, ['send {"email": "<the whole address>"}'])
    const found = await find(email)
    if (found.length > 1) return c.json({ error: 'ambiguous' }, 409)
    const [row] = found
    c.header('cache-control', 'no-store')
    if (!row) return c.json({ found: false })
    return c.json({ found: true, createdAt: row.created_at.getTime(), lastSignInAt: row.last_sign_in_at?.getTime() ?? null, details: await detailsOf(row) })
  })

  /** Deletes as the learner's own deletion does (deletion.ts). The body guards against a stray request. */
  app.post('/v1/admin/accounts/delete', admin, async (c) => {
    const body = await readJson(c)
    const email = emailOf(body)
    const confirmed = typeof body === 'object' && body !== null && (body as { confirm?: unknown }).confirm === true
    if (email === null || !confirmed) return invalid(c, ['send {"email": "<the whole address>", "confirm": true} to delete the account'])
    const found = await find(email)
    if (found.length > 1) return c.json({ error: 'ambiguous' }, 409)
    const deleted = found[0] ? await deleteAccount(deps.db, found[0].id) : false
    if (deleted) console.log('admin: 1 account deleted')
    c.header('cache-control', 'no-store')
    return c.json({ deleted })
  })

  app.get('/v1/admin/accounts/sweep', admin, async (c) => {
    c.header('cache-control', 'no-store')
    return c.json(await accountSweepStatus(deps))
  })

  /** How many accounts there are and how many are used (stats.ts): numbers only, and nothing is logged. */
  app.get('/v1/admin/accounts/stats', admin, async (c) => {
    c.header('cache-control', 'no-store')
    return c.json(await accountStats(deps))
  })

  /** What is behind those counts (#209): the accounts by week made and by day studied, and by language. Numbers only, and nothing is logged. */
  app.get('/v1/admin/accounts/series', admin, async (c) => {
    c.header('cache-control', 'no-store')
    return c.json(await accountSeries(deps))
  })

  app.get('/v1/admin/accounts/splits', admin, async (c) => {
    c.header('cache-control', 'no-store')
    return c.json(await accountSplits(deps))
  })
}
