import type { ServerDeps } from '../deps'
import { eraseAccount } from './deletion'

/** How long an account may go without a sign-in before it is deleted: what the terms and the privacy policy say. */
export const INACTIVE_ACCOUNT_MONTHS = 24
/** That time on the clock: two years with a leap day in them, the longest 24 months there are, so never a day early. */
export const INACTIVE_ACCOUNT_MS = 731 * 86_400_000
/** The accounts one run deletes at most: each is a transaction of its own, and a run must fit the Worker's limits. */
export const ACCOUNT_SWEEP_BATCH = 50

const DAY_MS = 86_400_000

/**
 * An account `u` the sweep may take, with the threshold as `$1`: its last sign-in is known and is before the
 * threshold. One with no date is never taken. Nor is one with a session used since the threshold, whatever its
 * date says: should the date ever fail to be written, a learner who is here is still not deleted.
 */
const DUE = `u.last_sign_in_at is not null and u.last_sign_in_at < $1
  and not exists (select 1 from "session" s where s."userId" = u.id and s."updatedAt" >= $1)`

const threshold = (now: number): Date => new Date(now - INACTIVE_ACCOUNT_MS)

/**
 * The cron's step (#187): deletes accounts not signed in to for 24 months, with the learner's own deletion
 * (deletion.ts). The cron comes every 15 minutes; the work is done once a UTC day, by the first run to take
 * the day's row, and every other run answers null. At most ACCOUNT_SWEEP_BATCH accounts go in a run, the
 * longest away first; the rest wait for the next day. Each account is checked again and deleted in its own
 * transaction, so one that signs in meanwhile is kept, and the day's count is exact wherever a run stops.
 * No mail is sent first: the rule is in the terms. The log has the count and nothing of an account.
 */
export async function sweepInactiveAccounts(deps: ServerDeps): Promise<number | null> {
  const now = deps.now()
  const day = Math.floor(now / DAY_MS)
  const taken = await deps.db.query('insert into account_sweep (utc_day, ran_at) values ($1, $2) on conflict (utc_day) do nothing returning utc_day', [day, now])
  if (taken.length === 0) return null
  const before = threshold(now)
  const due = await deps.db.query<{ id: string }>(`select u.id from "user" u where ${DUE} order by u.last_sign_in_at, u.id limit $2`, [before, ACCOUNT_SWEEP_BATCH])
  let deleted = 0
  let failed = 0
  for (const { id } of due) {
    try {
      const gone = await deps.db.transaction(async (tx) => {
        const still = await tx.query(`select u.id from "user" u where ${DUE} and u.id = $2 for update of u`, [before, id])
        if (still.length === 0 || !(await eraseAccount(tx, id))) return false
        await tx.query('update account_sweep set deleted = deleted + 1 where utc_day = $1', [day])
        return true
      })
      if (gone) deleted += 1
    } catch {
      // One account that cannot be deleted does not keep the others; what failed is not logged, since it may name the account.
      failed += 1
    }
  }
  console.log(`account sweep: ${deleted} inactive account(s) deleted`)
  if (failed > 0) throw new Error(`account sweep: ${failed} account(s) could not be deleted`)
  return deleted
}

/** What the review app shows of the sweep (#187): counts and times, nothing of an account. */
export interface AccountSweepStatus {
  /** The threshold in months, and the most one run deletes. */
  readonly months: number
  readonly batch: number
  /** The accounts past the threshold now: the next run takes the longest away of them, up to `batch`. */
  readonly due: number
  /** The accounts with no date of a last sign-in, which no run takes. */
  readonly undated: number
  /** The accounts every run so far deleted, together. */
  readonly taken: number
  /** The last run, in epoch milliseconds, and how many it deleted; null and 0 before the first. */
  readonly lastRunAt: number | null
  readonly lastTaken: number
}

export async function accountSweepStatus(deps: ServerDeps): Promise<AccountSweepStatus> {
  const [[accounts], [runs], [last]] = await Promise.all([
    deps.db.query<{ due: number; undated: number }>(
      `select count(*) filter (where ${DUE})::int as due, count(*) filter (where u.last_sign_in_at is null)::int as undated from "user" u`,
      [threshold(deps.now())],
    ),
    deps.db.query<{ taken: number }>('select coalesce(sum(deleted), 0)::int as taken from account_sweep'),
    deps.db.query<{ ran_at: number; deleted: number }>('select ran_at, deleted from account_sweep order by utc_day desc limit 1'),
  ])
  return {
    months: INACTIVE_ACCOUNT_MONTHS,
    batch: ACCOUNT_SWEEP_BATCH,
    due: accounts?.due ?? 0,
    undated: accounts?.undated ?? 0,
    taken: runs?.taken ?? 0,
    lastRunAt: last?.ran_at ?? null,
    lastTaken: last?.deleted ?? 0,
  }
}
