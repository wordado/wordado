import type { FeedbackItem, FeedbackKind } from '@wordado/core'
import type { FeedbackAiRead, FeedbackAiStatus, FeedbackAiView, FeedbackAiWhy } from '../shared/hosted'
import type { Deps } from './app'
import { aiCallsToday, claimAiCall, feedbackAiRows, getSetting, insertTopicsIfAbsent, openIssues, proposeTopicIssues, putFeedbackAi, topicTitles, type FeedbackAiRow, type FeedbackAiStored } from './db'
import { aiConfig, aiLimits, aiSetup } from './feedbackAiConfig'
import { askModel } from './feedbackModel'
import { messagesRequest, MODEL_ISSUES, MODEL_TOPICS, PROMPT_VERSION, readMessagesAnswer, type ModelContext } from './feedbackPrompt'
import { readFeedback, type FeedbackSource } from './learnerApp'
import { appRepo } from './openIssues'

/** The messages asked of the learner app's server for one page of the tab: one request to it for each page shown. */
export const FEEDBACK_PAGE = 50
/** Messages sent to the model in one call: more would not be read inside its twenty seconds. */
export const AI_BATCH = 25
/** The name the switch has in `settings`: 'on' or 'off', and off while there is no row. */
export const AI_SWITCH = 'feedback_ai'
/** How old the list of open issues may be and still be offered to the model: it is read once a day, and a day's read may fail. */
export const ISSUES_FRESH_MS = 48 * 60 * 60 * 1000

/** A reading as the tab shows it: what the AI said of the message, and the topic the message is in now. */
export function aiView(row: FeedbackAiStored): FeedbackAiView {
  return { language: row.language, translation: row.translation, category: row.category, severity: row.severity, summary: row.summary, topic: row.topicId !== null && row.topicTitle !== null ? { id: row.topicId, title: row.topicTitle } : null }
}

/** Whether the help is set up (and the setting it needs while it is not), whether an admin switched it on, and how the day's limit stands. */
export async function aiStatus(deps: Pick<Deps, 'env' | 'now'>): Promise<FeedbackAiStatus> {
  const [on, callsToday] = await Promise.all([getSetting(deps.env.DB, AI_SWITCH), aiCallsToday(deps.env.DB, deps.now())])
  const { needs } = aiSetup(deps.env)
  return { setUp: needs === null, needs, on: on === 'on', callsToday, ...aiLimits(deps.env), repo: appRepo(deps.env) ?? '' }
}

/**
 * Reads the page again, asks the model about the messages with no result of this prompt version, keeps what fits,
 * and answers the readings the page's messages now have, the new ones and those kept before.
 * At most two requests go out: one to the learner app's server, one to the model, for at most AI_BATCH messages,
 * the newest first; the rest are counted in `left`. Without a key or switched off, none goes out. A call is counted
 * before it is made. Throws FeedbackUnread when the learner app's server does not give the page.
 * With the messages the model is given the topics so far and the open issues as last read (both from the database),
 * and a reading may put its message in a topic and name a known issue (spec 2026-10-10 §3.2, §3.3). What comes of an
 * answer is, for each message asked about, its own row, and beside that only: a new topic by a title that may be
 * one, and a proposed match on a topic that has none. No mark, no state, no title and no confirmed match is changed.
 */
export async function readPageAi(deps: Deps, source: FeedbackSource, page: { readonly kind: FeedbackKind | null; readonly before: number | null }): Promise<FeedbackAiRead> {
  const nothing = (why: FeedbackAiWhy | null, asked = 0, left = 0): FeedbackAiRead => ({ results: {}, asked, left, why })
  const config = aiConfig(deps.env)
  if (!config) return nothing('not-set-up')
  if ((await getSetting(deps.env.DB, AI_SWITCH)) !== 'on') return nothing('off')
  const { items } = await readFeedback(deps, source, { limit: FEEDBACK_PAGE, kind: page.kind, before: page.before })
  const stored = await feedbackAiRows(deps.env.DB, items.map((item) => item.id))
  const todo: FeedbackItem[] = items.filter((item) => stored.get(item.id)?.promptVersion !== PROMPT_VERSION)
  // The readings the page's messages already have. They go back with every answer that names no failure: the list
  // the tab holds may have been read a moment before another request kept them, and would never show them otherwise.
  const have: Record<number, FeedbackAiView> = {}
  for (const [id, row] of stored) if (row.promptVersion === PROMPT_VERSION) have[id] = aiView(row)
  if (todo.length === 0) return { results: have, asked: 0, left: 0, why: null }
  const batch = todo.slice(0, AI_BATCH)
  // From the database alone: still one read of the learner app's server and one call to the model.
  const [topics, issues] = await Promise.all([topicTitles(deps.env.DB, MODEL_TOPICS), openIssues(deps.env.DB, new Date(deps.now().getTime() - ISSUES_FRESH_MS).toISOString(), MODEL_ISSUES)])
  const context: ModelContext = { topics, issues }
  if (!(await claimAiCall(deps.env.DB, deps.now(), 'messages', batch.length, config.dailyCalls))) return nothing('limit', 0, todo.length)
  const answer = await askModel(deps, config, messagesRequest(batch, config.reads, context))
  if (!answer.ok) return nothing(answer.why, batch.length, todo.length)
  // The answer changes nothing but these rows: what does not fit is left out, and a message keeps no result.
  const read = readMessagesAnswer(answer.value, batch, config.reads, context)
  if (read === null || read.size === 0) return nothing('unfit', batch.length, todo.length)
  const createdAt = deps.now().toISOString()
  // New topics first, so that a reading can name its own. A title some topic has is that topic.
  const titles = [...new Set([...read.values()].flatMap((r) => (r.topic && 'new' in r.topic ? [r.topic.new] : [])))]
  const made = await insertTopicsIfAbsent(deps.env.DB, titles, createdAt)
  const rows = new Map<number, FeedbackAiRow>()
  for (const item of batch) {
    const one = read.get(item.id)
    if (!one) continue
    const topicId = one.topic === null ? null : 'existing' in one.topic ? one.topic.existing : (made.get(one.topic.new) ?? null)
    rows.set(item.id, { ...one.ai, receivedAt: item.receivedAt, model: config.model, promptVersion: PROMPT_VERSION, createdAt, topicId })
  }
  await putFeedbackAi(deps.env.DB, rows)
  // Read back, since a message the coordinator moved kept its topic: the page shows where each message is now.
  const kept = await feedbackAiRows(deps.env.DB, [...rows.keys()])
  // A known issue is proposed for the topic the reading put its message in, the first one named for a topic, and
  // not for the topic of a message the coordinator moved, which the reading knew nothing of.
  const proposals = new Map<number, number>()
  for (const [id, row] of rows) {
    const issue = read.get(id)?.issue ?? null
    const now = kept.get(id)
    if (issue === null || !now || now.topicBy !== 'ai' || now.topicId === null || now.topicId !== row.topicId || proposals.has(now.topicId)) continue
    proposals.set(now.topicId, issue)
  }
  await proposeTopicIssues(deps.env.DB, [...proposals].map(([topic, issue]) => ({ topic, issue })))
  const results: Record<number, FeedbackAiView> = { ...have }
  for (const [id, row] of kept) results[id] = aiView(row)
  return { results, asked: batch.length, left: todo.length - rows.size, why: null }
}
