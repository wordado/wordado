import { FEEDBACK_KINDS, type FeedbackKind } from '@wordado/core'
import type { Hono } from 'hono'
import { FEEDBACK_STATE_FILTERS, FEEDBACK_STATES, MAX_FEEDBACK_NOTE_LENGTH, type FeedbackList, type FeedbackState, type FeedbackStateFilter, type FeedbackView } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { dropFeedbackAiNotIn, feedbackAiRows, feedbackMarks, putFeedbackMark } from '../db'
import { FEEDBACK_PAGE } from '../feedbackAi'
import { FeedbackUnread, feedbackSource, readFeedback } from '../learnerApp'

export { FEEDBACK_PAGE }

const SHOWN: Readonly<Record<FeedbackStateFilter, readonly FeedbackState[]>> = { open: ['new', 'seen'], all: FEEDBACK_STATES, done: ['done'], declined: ['declined'] }

/** The id of a message in an address or a query: a whole number from 1 up. */
const idOf = (raw: string): number | null => (/^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : null)

/** Registered after adminRoutes, so both routes are behind the admin-only middleware. */
export function feedbackRoutes(app: Hono<AppEnv>, deps: Deps): void {
  /**
   * The Feedback tab (spec §16): one page of learners' feedback, read from the learner app's server as it is asked
   * for and never kept, each message with the coordinator's own mark. `kind` is filtered by that server; `state`
   * is filtered here, after the page is read, since only the review app knows the marks: a page can therefore hold
   * fewer messages than were read (`read`), or none, while `nextBefore` still leads to the older ones.
   * Each message also has the AI's reading when one is kept (spec 2026-10-10 §3.1); the model is not asked here.
   */
  app.get('/api/admin/feedback', async (c) => {
    const source = feedbackSource(deps)
    if (!source) return c.json({ connected: false } satisfies FeedbackList)
    const kind = c.req.query('kind') || null
    const state = c.req.query('state') || 'all'
    const before = c.req.query('before') ? idOf(c.req.query('before')!) : null
    if (kind !== null && !(FEEDBACK_KINDS as readonly string[]).includes(kind)) return apiError(c, 400, `kind must be one of ${FEEDBACK_KINDS.join(', ')}`)
    if (!(FEEDBACK_STATE_FILTERS as readonly string[]).includes(state)) return apiError(c, 400, `state must be one of ${FEEDBACK_STATE_FILTERS.join(', ')}`)
    if (c.req.query('before') && before === null) return apiError(c, 400, 'before must be the id of a message')
    let page: Awaited<ReturnType<typeof readFeedback>>
    try {
      page = await readFeedback(deps, source, { limit: FEEDBACK_PAGE, kind: kind as FeedbackKind | null, before })
    } catch (err) {
      if (err instanceof FeedbackUnread) return apiError(c, 502, err.message)
      throw err
    }
    const ids = page.items.map((item) => item.id)
    // The AI's reading of a message goes when its message does (spec 2026-10-10 §4). A page read with no filter by
    // kind holds every message between its ends: the top is the cursor, or open on the newest page; the bottom is
    // its last message, or open on the oldest page. A reading kept inside them for a message the server did not give
    // is of a message that is gone. An empty page drops nothing.
    if (kind === null && ids.length > 0) {
      await dropFeedbackAiNotIn(deps.env.DB, page.nextBefore === null ? 1 : ids.at(-1)!, before === null ? Number.MAX_SAFE_INTEGER : before - 1, ids)
    }
    const [marks, readings] = await Promise.all([feedbackMarks(deps.env.DB, ids), feedbackAiRows(deps.env.DB, ids)])
    const shown = SHOWN[state as FeedbackStateFilter]
    const items: FeedbackView[] = page.items
      .map((item) => {
        const mark = marks.get(item.id)
        const ai = readings.get(item.id)
        return {
          ...item,
          state: mark?.state ?? 'new',
          note: mark?.note ?? '',
          markedAt: mark?.updatedAt ?? null,
          // A reading of an older prompt version is shown until it is replaced.
          ai: ai ? { language: ai.language, translation: ai.translation, category: ai.category, severity: ai.severity, summary: ai.summary } : null,
        }
      })
      .filter((item) => shown.includes(item.state))
    return c.json({ connected: true, items, read: page.items.length, nextBefore: page.nextBefore } satisfies FeedbackList)
  })

  /** Sets a message's mark: its state and the coordinator's note, both each time. Nothing goes to the learner app's server. */
  app.put('/api/admin/feedback/:id', async (c) => {
    const id = idOf(c.req.param('id'))
    if (id === null) return apiError(c, 400, 'that is not the id of a message')
    const body = await jsonBody<Record<string, unknown>>(c)
    const { state, note } = body
    const extra = Object.keys(body).find((key) => key !== 'state' && key !== 'note')
    if (extra !== undefined) return apiError(c, 400, `a mark has a state and a note, and no ${extra}`)
    if (!(FEEDBACK_STATES as readonly unknown[]).includes(state)) return apiError(c, 400, `state must be one of ${FEEDBACK_STATES.join(', ')}`)
    if (typeof note !== 'string' || note.length > MAX_FEEDBACK_NOTE_LENGTH) return apiError(c, 400, `note must be text of at most ${MAX_FEEDBACK_NOTE_LENGTH} characters`)
    const mark = { state: state as FeedbackState, note: note.trim(), updatedAt: deps.now().toISOString() }
    await putFeedbackMark(deps.env.DB, id, { ...mark, updatedBy: c.get('me').email })
    return c.json({ id, state: mark.state, note: mark.note, markedAt: mark.updatedAt })
  })
}
