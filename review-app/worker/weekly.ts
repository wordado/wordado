import { FEEDBACK_KINDS, type FeedbackItem, type FeedbackKind } from '@wordado/core'
import type { Deps } from './app'
import { claimWeeklyMail, dropOldAiCalls, feedbackAiIdsBetween, getSetting, listReviewers, releaseWeeklyMail, settleWeeklyMail } from './db'
import { AI_BATCH, AI_SWITCH, readBatchAi } from './feedbackAi'
import { aiConfig } from './feedbackAiConfig'
import { PROMPT_VERSION } from './feedbackPrompt'
import { weekNumbers, weekParagraph } from './feedbackWeek'
import { FeedbackUnread, feedbackSource, readFeedback, type FeedbackSource } from './learnerApp'
import { MailRefused, reviewMailer, type WeekMailAi } from './mail'

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

/** How the week's feedback counts by the learner's own kind, and the week's messages themselves, the newest first:
 * they are held for the run only, for the AI to read those it has not read yet, and are never kept or logged. */
export async function countWeek(deps: Pick<Deps, 'fetch' | 'log'>, source: FeedbackSource, period: { since: number; until: number }): Promise<{ total: number; more: boolean; byKind: Record<FeedbackKind, number>; items: FeedbackItem[] }> {
  const byKind = Object.fromEntries(FEEDBACK_KINDS.map((kind) => [kind, 0])) as Record<FeedbackKind, number>
  const items: FeedbackItem[] = []
  let before: number | null = null
  for (let page = 0; page < WEEKLY_PAGES; page += 1) {
    const read = await readFeedback(deps, source, { limit: PAGE, since: period.since, before })
    for (const item of read.items) {
      // The server's read has no end: what came after the week is dropped here.
      if (item.receivedAt >= period.until) continue
      items.push(item)
      byKind[item.kind] += 1
    }
    before = read.nextBefore
    if (before === null) return { total: items.length, more: false, byKind, items }
  }
  return { total: items.length, more: true, byKind, items }
}

/** Calls to the model in one job for the week's messages that have no reading, AI_BATCH messages each; one more is made for the paragraph. */
export const WEEKLY_AI_CALLS = 4
/** How long the counts of calls and the week's paragraphs are kept. */
const KEPT_DAYS = 30

/**
 * What the AI adds to the week's mail (spec 2026-10-10 §3.4), or nothing: then the mail is the one it is without
 * the AI help. With the help set up and switched on, the week's messages that have no reading are read first, the
 * newest first, in at most WEEKLY_AI_CALLS calls; then the week is counted from the readings, and one more call
 * asks for the paragraph, which is written from the counts and the topics' titles alone. Every call is counted
 * against the day's limit. When a call fails or the limit is reached, the job stops asking and the AI adds nothing;
 * what was read until then is kept, for the tab. A paragraph that was refused (one with an address or a link, say)
 * leaves the AI's numbers in the mail, without it.
 */
async function weekAi(deps: Deps, week: string, period: { readonly since: number; readonly until: number }, items: readonly FeedbackItem[]): Promise<WeekMailAi | undefined> {
  const config = aiConfig(deps.env)
  if (!config || (await getSetting(deps.env.DB, AI_SWITCH)) !== 'on') return undefined
  const without = (why: string) => (deps.log(`weekly mail: without the AI’s part (${why})`), undefined)
  const read = await feedbackAiIdsBetween(deps.env.DB, period.since, period.until, PROMPT_VERSION)
  const unread = items.filter((item) => !read.has(item.id)).slice(0, WEEKLY_AI_CALLS * AI_BATCH)
  for (let at = 0; at < unread.length; at += AI_BATCH) {
    const { why } = await readBatchAi(deps, config, unread.slice(at, at + AI_BATCH))
    if (why !== null) return without(why)
  }
  const numbers = await weekNumbers(deps.env.DB, period)
  if (numbers.read === 0) return undefined
  const { paragraph, why } = await weekParagraph(deps, `w:${week}`, numbers)
  // 'unfit' is a paragraph that was written and refused: the numbers go without it.
  if (paragraph === null && why !== 'unfit') return without(why ?? 'no paragraph')
  return {
    // A reading may be left of a message the server no longer gives: never more than the week had.
    read: Math.min(numbers.read, items.length),
    byCategory: numbers.byCategory,
    topTopics: numbers.topTopics.map((t) => ({ title: t.title, count: t.count })),
    blockingBugs: numbers.blockingBugs,
    newTopics: numbers.newTopics.map((t) => t.title),
    paragraph,
  }
}

export type WeeklyOutcome = 'sent' | 'none' | 'already' | 'unconnected' | 'failed'

/** The job could not finish for a reason of its own: `message` is for the log. */
class WeeklyStopped extends Error {}

/**
 * The timed job (spec 2026-10-10 §3.4): one mail a week to the admins, when feedback came. Never throws.
 * What it asks of others in one run, at most: WEEKLY_PAGES reads of the learner app's server, WEEKLY_AI_CALLS + 1
 * calls to the model (and one for a token, when it signs in with one), and one mail.
 */
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
    // Housekeeping that the mail does not wait for: what is too old to count goes.
    await dropOldAiCalls(deps.env.DB, dateOf(deps.now().getTime() - KEPT_DAYS * DAY_MS)).catch(() => undefined)
    const { items, ...counted } = await countWeek(deps, source, { since, until })
    if (counted.total === 0) {
      await settleWeeklyMail(deps.env.DB, week, 0, null)
      deps.log(`weekly mail: no feedback in the week that ended on ${week}`)
      return 'none'
    }
    const admins = (await listReviewers(deps.env.DB)).filter((r) => r.role === 'admin' && !r.disabledAt).map((r) => r.email)
    if (admins.length === 0) throw new WeeklyStopped('no admin to send it to')
    // The AI's part never keeps the mail from going: whatever goes wrong with it, the mail is the one without it.
    const ai = await weekAi(deps, week, { since, until }, items).catch((err: unknown) => (deps.log(`weekly mail: without the AI’s part (${err instanceof Error ? err.name : 'error'})`), undefined))
    await reviewMailer(deps).weekly(admins, { from: dateOf(since), to: dateOf(until - DAY_MS), ...counted, ...(ai ? { ai } : {}) })
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
