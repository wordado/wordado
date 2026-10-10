import { FEEDBACK_KINDS, type FeedbackKind } from '@wordado/core'
import type { Deps } from './app'
import { claimWeeklyMail, listReviewers, releaseWeeklyMail, settleWeeklyMail } from './db'
import { FeedbackUnread, feedbackSource, readFeedback, type FeedbackSource } from './learnerApp'
import { MailRefused, reviewMailer } from './mail'

const DAY_MS = 24 * 60 * 60 * 1000
const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The week that ended on the Monday of `now`'s UTC week: its key, and its bounds in epoch milliseconds. */
export function weekOf(now: Date): { readonly week: string; readonly since: number; readonly until: number } {
  // getUTCDay counts from Sunday; the week here starts on Monday.
  const sinceMonday = (now.getUTCDay() + 6) % 7
  const until = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday)
  return { week: dateOf(until), since: until - 7 * DAY_MS, until }
}

/** Pages of the learner app's read in one job, 100 messages each. */
export const WEEKLY_PAGES = 10
const PAGE = 100

/** How the week's feedback counts by the learner's own kind. Only numbers are kept as the pages are read. */
export async function countWeek(deps: Pick<Deps, 'fetch' | 'log'>, source: FeedbackSource, period: { since: number; until: number }): Promise<{ total: number; more: boolean; byKind: Record<FeedbackKind, number> }> {
  const byKind = Object.fromEntries(FEEDBACK_KINDS.map((kind) => [kind, 0])) as Record<FeedbackKind, number>
  let total = 0
  let before: number | null = null
  for (let page = 0; page < WEEKLY_PAGES; page += 1) {
    const read = await readFeedback(deps, source, { limit: PAGE, since: period.since, before })
    for (const item of read.items) {
      // The server's read has no end: what came after the week is dropped here.
      if (item.receivedAt >= period.until) continue
      total += 1
      byKind[item.kind] += 1
    }
    before = read.nextBefore
    if (before === null) return { total, more: false, byKind }
  }
  return { total, more: true, byKind }
}

export type WeeklyOutcome = 'sent' | 'none' | 'already' | 'unconnected' | 'failed'

/** The job could not finish for a reason of its own: `message` is for the log. */
class WeeklyStopped extends Error {}

/** The timed job (spec 2026-10-10 §3.4): one mail a week to the admins, when feedback came. Never throws. */
export async function runWeekly(deps: Deps): Promise<WeeklyOutcome> {
  const source = feedbackSource(deps)
  if (!source) {
    deps.log('weekly mail: not connected, LEARNER_APP_URL and FEEDBACK_READ_TOKEN are not both set')
    return 'unconnected'
  }
  const { week, since, until } = weekOf(deps.now())
  let held = false
  let sent = false
  try {
    // Before anything is read: a second run in the same week asks nothing of anyone.
    held = await claimWeeklyMail(deps.env.DB, week, deps.now())
    if (!held) {
      deps.log(`weekly mail: the week that ended on ${week} is already done`)
      return 'already'
    }
    const counted = await countWeek(deps, source, { since, until })
    if (counted.total === 0) {
      await settleWeeklyMail(deps.env.DB, week, 0, null)
      deps.log(`weekly mail: no feedback in the week that ended on ${week}`)
      return 'none'
    }
    const admins = (await listReviewers(deps.env.DB)).filter((r) => r.role === 'admin' && !r.disabledAt).map((r) => r.email)
    if (admins.length === 0) throw new WeeklyStopped('no admin to send it to')
    await reviewMailer(deps).weekly(admins, { from: dateOf(since), to: dateOf(until - DAY_MS), ...counted })
    sent = true
    await settleWeeklyMail(deps.env.DB, week, counted.total, deps.now().toISOString())
    deps.log(`weekly mail: sent for the week that ended on ${week}`)
    return 'sent'
  } catch (err) {
    // Only what these three errors say is known to hold nothing of a request; of any other, the name alone.
    const why = err instanceof FeedbackUnread || err instanceof MailRefused || err instanceof WeeklyStopped ? err.message : err instanceof Error ? err.name : 'error'
    if (sent) {
      // The mail is out, so the week is not given back: the claim stands for its hour and the mail is not sent again at once.
      deps.log(`weekly mail: sent for the week that ended on ${week}, but not recorded: ${why}`)
      return 'sent'
    }
    if (held) await releaseWeeklyMail(deps.env.DB, week).catch(() => undefined)
    deps.log(`weekly mail not sent: ${why}`)
    return 'failed'
  }
}
