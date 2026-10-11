import type { ServerDeps } from '../deps'

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
