import { ANNOUNCEMENT_LANGUAGES, type AnnouncementLanguage } from '@wordado/core'
import { KNOWN_LANGUAGE_OF } from '../announcements/store'
import type { ServerDeps } from '../deps'
import { MAX_IGNORED_REMINDERS } from '../reminders/schedule'

const DAY_MS = 86_400_000

/** What the review app shows of the accounts and their use (#206): counts of now, nothing of an account. */
export interface AccountStats {
  /** When the counts were read, in epoch milliseconds: the 7 and 30 days are counted back from it. */
  readonly readAt: number
  /** The accounts there are, and those made in the last 7 and 30 days. */
  readonly accounts: number
  readonly made7: number
  readonly made30: number
  /** The accounts with at least one answer in the last 7 and 30 days. */
  readonly studied7: number
  readonly studied30: number
  /** The accounts by what they said to news by email; the three add up to `accounts`. */
  readonly newsGiven: number
  readonly newsWithdrawn: number
  readonly newsNone: number
  /** The accounts with reminders on: at least one device subscribed to them. */
  readonly reminders: number
}

/**
 * The counts, from what the server already holds. An account studied when one of its devices has an answer since
 * then: the device row keeps the time of the last answer accepted from it (`effective_ts`, the server's stamp of
 * when the answer was given, which only moves forward), so the answer log is not read at all. A device has one
 * row and an account few devices: the three statements read tables of about as many rows as there are accounts.
 * On the edge counts as within: 7 days ago to the millisecond is in the last 7 days.
 */
export async function accountStats(deps: ServerDeps): Promise<AccountStats> {
  const readAt = deps.now()
  const [week, month] = [readAt - 7 * DAY_MS, readAt - 30 * DAY_MS]
  const [[accounts], [studied], [subscribed]] = await Promise.all([
    deps.db.query<{ accounts: number; made7: number; made30: number; given: number; withdrawn: number; none: number }>(
      `select count(*)::int as accounts,
              count(*) filter (where "createdAt" >= $1)::int as made7,
              count(*) filter (where "createdAt" >= $2)::int as made30,
              count(*) filter (where news_consent = 'given')::int as given,
              count(*) filter (where news_consent = 'withdrawn')::int as withdrawn,
              count(*) filter (where news_consent = 'none')::int as none
       from "user"`,
      [new Date(week), new Date(month)],
    ),
    deps.db.query<{ studied7: number; studied30: number }>(
      `select count(distinct user_id) filter (where effective_ts >= $1)::int as studied7, count(distinct user_id)::int as studied30
       from device where effective_ts >= $2`,
      [week, month],
    ),
    deps.db.query<{ reminders: number }>('select count(distinct user_id)::int as reminders from push_subscription'),
  ])
  return {
    readAt,
    accounts: accounts?.accounts ?? 0,
    made7: accounts?.made7 ?? 0,
    made30: accounts?.made30 ?? 0,
    studied7: studied?.studied7 ?? 0,
    studied30: studied?.studied30 ?? 0,
    newsGiven: accounts?.given ?? 0,
    newsWithdrawn: accounts?.withdrawn ?? 0,
    newsNone: accounts?.none ?? 0,
    reminders: subscribed?.reminders ?? 0,
  }
}

/** How far back the series go: what the review app's widest period shows. */
export const SERIES_WEEKS = 26
export const SERIES_DAYS = 90

/** The UTC day of a moment, as `review_event.utc_day` has it, and the week of a UTC day: weeks begin on Monday (day 0 was a Thursday). */
const utcDayOf = (ms: number): number => Math.floor(ms / DAY_MS)
const weekOf = (utcDay: number): number => Math.floor((utcDay + 3) / 7)
const firstDayOf = (week: number): number => week * 7 - 3

/** What is behind the counts over time (#209): numbers by week and by day, nothing of an account. */
export interface AccountSeries {
  /** When the series were read, in epoch milliseconds: the last week and the last day are the ones it falls in. */
  readonly readAt: number
  /** The accounts there are. Those made before the first week are these less the weeks. */
  readonly accounts: number
  /** The accounts that exist now by the week they were made, oldest first; the last week began at `weekStart` (a
   * Monday, 00:00 UTC, in epoch milliseconds) and is not over. A deleted account is in none of them. */
  readonly weekStart: number
  readonly madeByWeek: readonly number[]
  /** The accounts with at least one answer on each UTC day, oldest first; the last day began at `dayStart`
   * (00:00 UTC, in epoch milliseconds) and is not over. */
  readonly dayStart: number
  readonly studiedByDay: readonly number[]
}

/**
 * The series. Weeks and days are UTC ones: one calendar for every account, whatever its own time zone.
 * The weeks read `"user"` once, as the counts do. The days are the one question the device rows cannot answer
 * (they keep the last answer only), so they come from the answer log, by its index on `(user_id, utc_day)` and
 * never by reading it through: first the accounts with any answer since the first day (one probe an account),
 * then each of those on each day (one probe each, which stops at the first answer). That is the accounts
 * + 90 x the accounts that studied in the 90 days, however many answers they gave. The probes are written as
 * subqueries with `limit 1` so that they stay probes: as `exists`, the planner turns them into one pass over
 * the whole log. `utc_day` is the day of the server's stamp of when the answer was given, so an answer sent late
 * counts on the day it was given.
 */
export async function accountSeries(deps: ServerDeps): Promise<AccountSeries> {
  const readAt = deps.now()
  const today = utcDayOf(readAt)
  const week = weekOf(today)
  const [firstWeek, firstDay] = [week - SERIES_WEEKS + 1, today - SERIES_DAYS + 1]
  const [made, studied] = await Promise.all([
    deps.db.query<{ week: number | null; made: number }>(
      `select case when "createdAt" >= $1 then floor((floor(extract(epoch from "createdAt") / 86400) + 3) / 7)::int end as week, count(*)::int as made
       from "user" group by 1`,
      [new Date(firstDayOf(firstWeek) * DAY_MS)],
    ),
    deps.db.query<{ day: number; accounts: number }>(
      `with studying as materialized (
         select u.id from "user" u where (select true from review_event e where e.user_id = u.id and e.utc_day >= $1 limit 1)
       )
       select d.day, count(*)::int as accounts
       from studying a cross join generate_series($1::int, $2::int) as d(day)
       where (select true from review_event e where e.user_id = a.id and e.utc_day = d.day limit 1)
       group by d.day`,
      [firstDay, today],
    ),
  ])
  const madeByWeek = Array.from({ length: SERIES_WEEKS }, () => 0)
  // An account dated after now (a clock that was ahead) is of the last week.
  for (const row of made) if (row.week !== null) madeByWeek[Math.min(row.week, week) - firstWeek]! += row.made
  const studiedByDay = Array.from({ length: SERIES_DAYS }, () => 0)
  for (const row of studied) studiedByDay[row.day - firstDay] = row.accounts
  return {
    readAt,
    accounts: made.reduce((sum, row) => sum + row.made, 0),
    weekStart: firstDayOf(week) * DAY_MS,
    madeByWeek,
    dayStart: today * DAY_MS,
    studiedByDay,
  }
}

/** What is behind the counts by language (#209). A language is null where it is not known. */
export interface AccountSplits {
  readonly readAt: number
  /** The accounts by what they said to news, one row for each language that has any; together, the accounts there are. */
  readonly news: readonly { readonly language: AnnouncementLanguage | null; readonly given: number; readonly withdrawn: number; readonly none: number }[]
  /** The accounts with reminders on, each once: those the app still sends to, and those it stopped sending to
   * after reminders were ignored. */
  readonly reminders: readonly { readonly language: AnnouncementLanguage | null; readonly sending: number; readonly paused: number }[]
}

const languageOf = (value: string | null): AnnouncementLanguage | null => ANNOUNCEMENT_LANGUAGES.find((l) => l === value) ?? null
/** In the order of the languages, the row of the unknown last. */
const inOrder = <T extends { readonly language: AnnouncementLanguage | null }>(rows: readonly T[]): T[] =>
  [...ANNOUNCEMENT_LANGUAGES, null].flatMap((language) => rows.filter((row) => row.language === language))

/**
 * The splits. News is by the account's interface language as an announcement reads it (announcements/store.ts):
 * so the accounts that agreed, by language, are the ones a news announcement would be written to in that
 * language. Not known is an account whose app never said its language and that left no other sign of one; an announcement writes to it in English.
 * Reminders are by the language the account's newest device asks them in, an account with several devices once;
 * it is paused when every one of its devices is (schedule.ts), and sending otherwise. Two statements, over
 * `"user"` (with the probes of the language, by primary key and by `push_subscription_user`) and
 * `push_subscription`: what the preview of an announcement already costs.
 */
export async function accountSplits(deps: ServerDeps): Promise<AccountSplits> {
  const readAt = deps.now()
  const [news, reminders] = await Promise.all([
    deps.db.query<{ language: string | null; given: number; withdrawn: number; none: number }>(
      `select ${KNOWN_LANGUAGE_OF} as language,
              count(*) filter (where u.news_consent = 'given')::int as given,
              count(*) filter (where u.news_consent = 'withdrawn')::int as withdrawn,
              count(*) filter (where u.news_consent = 'none')::int as none
       from "user" u group by 1`,
    ),
    deps.db.query<{ language: string | null; sending: number; paused: number }>(
      `select case when a.language in (${ANNOUNCEMENT_LANGUAGES.map((l) => `'${l}'`).join(', ')}) then a.language end as language, count(*) filter (where a.sending)::int as sending, count(*) filter (where not a.sending)::int as paused
       from (select (array_agg(p.language order by p.created_at desc, p.endpoint))[1] as language, bool_or(p.ignored < $1) as sending
             from push_subscription p group by p.user_id) a
       group by 1`,
      [MAX_IGNORED_REMINDERS],
    ),
  ])
  return {
    readAt,
    news: inOrder(news.map((row) => ({ language: languageOf(row.language), given: row.given, withdrawn: row.withdrawn, none: row.none }))),
    reminders: inOrder(reminders.map((row) => ({ language: languageOf(row.language), sending: row.sending, paused: row.paused }))),
  }
}
