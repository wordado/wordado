import { FEEDBACK_KINDS, type FeedbackKind } from '@wordado/core'
import type { Hono } from 'hono'
import { FEEDBACK_STATE_FILTERS, FEEDBACK_STATES, MAX_FEEDBACK_NOTE_LENGTH, type FeedbackList, type FeedbackState, type FeedbackStateFilter, type FeedbackView } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { feedbackMarks, putFeedbackMark } from '../db'
import { FeedbackUnread, feedbackSource, readFeedback } from '../learnerApp'

/** The messages asked of the learner app's server for one page of the tab: one request to it for each page shown. */
export const FEEDBACK_PAGE = 50

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
    const marks = await feedbackMarks(deps.env.DB, page.items.map((item) => item.id))
    const shown = SHOWN[state as FeedbackStateFilter]
    const items: FeedbackView[] = page.items
      .map((item) => {
        const mark = marks.get(item.id)
        return { ...item, state: mark?.state ?? 'new', note: mark?.note ?? '', markedAt: mark?.updatedAt ?? null }
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
