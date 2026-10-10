import type { FeedbackItem, FeedbackKind } from '@wordado/core'
import type { FeedbackAi, FeedbackAiRead, FeedbackAiStatus, FeedbackAiWhy } from '../shared/hosted'
import type { Deps } from './app'
import { aiCallsToday, claimAiCall, feedbackAiRows, getSetting, putFeedbackAi, type FeedbackAiRow } from './db'
import { aiConfig, aiLimits, aiSetup } from './feedbackAiConfig'
import { askModel } from './feedbackModel'
import { messagesRequest, PROMPT_VERSION, readMessagesAnswer } from './feedbackPrompt'
import { readFeedback, type FeedbackSource } from './learnerApp'

/** The messages asked of the learner app's server for one page of the tab: one request to it for each page shown. */
export const FEEDBACK_PAGE = 50
/** Messages sent to the model in one call: more would not be read inside its twenty seconds. */
export const AI_BATCH = 25
/** The name the switch has in `settings`: 'on' or 'off', and off while there is no row. */
export const AI_SWITCH = 'feedback_ai'

/** Whether the help is set up (and the setting it needs while it is not), whether an admin switched it on, and how the day's limit stands. */
export async function aiStatus(deps: Pick<Deps, 'env' | 'now'>): Promise<FeedbackAiStatus> {
  const [on, callsToday] = await Promise.all([getSetting(deps.env.DB, AI_SWITCH), aiCallsToday(deps.env.DB, deps.now())])
  const { needs } = aiSetup(deps.env)
  return { setUp: needs === null, needs, on: on === 'on', callsToday, ...aiLimits(deps.env) }
}

/**
 * Reads the page again, asks the model about the messages with no result of this prompt version, keeps what fits.
 * At most two requests go out: one to the learner app's server, one to the model, for at most AI_BATCH messages,
 * the newest first; the rest are counted in `left`. Without a key or switched off, none goes out. A call is counted
 * before it is made. Throws FeedbackUnread when the learner app's server does not give the page.
 */
export async function readPageAi(deps: Deps, source: FeedbackSource, page: { readonly kind: FeedbackKind | null; readonly before: number | null }): Promise<FeedbackAiRead> {
  const nothing = (why: FeedbackAiWhy | null, asked = 0, left = 0): FeedbackAiRead => ({ results: {}, asked, left, why })
  const config = aiConfig(deps.env)
  if (!config) return nothing('not-set-up')
  if ((await getSetting(deps.env.DB, AI_SWITCH)) !== 'on') return nothing('off')
  const { items } = await readFeedback(deps, source, { limit: FEEDBACK_PAGE, kind: page.kind, before: page.before })
  const stored = await feedbackAiRows(deps.env.DB, items.map((item) => item.id))
  const todo: FeedbackItem[] = items.filter((item) => stored.get(item.id)?.promptVersion !== PROMPT_VERSION)
  if (todo.length === 0) return nothing(null)
  const batch = todo.slice(0, AI_BATCH)
  if (!(await claimAiCall(deps.env.DB, deps.now(), 'messages', batch.length, config.dailyCalls))) return nothing('limit', 0, todo.length)
  const answer = await askModel(deps, config, messagesRequest(batch, config.reads))
  if (!answer.ok) return nothing(answer.why, batch.length, todo.length)
  // The answer changes nothing but these rows: what does not fit is left out, and a message keeps no result.
  const read = readMessagesAnswer(answer.value, batch, config.reads)
  if (read === null || read.size === 0) return nothing('unfit', batch.length, todo.length)
  const createdAt = deps.now().toISOString()
  const rows = new Map<number, FeedbackAiRow>()
  const results: Record<number, FeedbackAi> = {}
  for (const item of batch) {
    const ai = read.get(item.id)
    if (!ai) continue
    rows.set(item.id, { ...ai, receivedAt: item.receivedAt, model: config.model, promptVersion: PROMPT_VERSION, createdAt })
    results[item.id] = ai
  }
  await putFeedbackAi(deps.env.DB, rows)
  return { results, asked: batch.length, left: todo.length - rows.size, why: null }
}
