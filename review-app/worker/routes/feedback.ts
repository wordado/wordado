import { FEEDBACK_KINDS, type FeedbackItem, type FeedbackKind } from '@wordado/core'
import type { Hono } from 'hono'
import { FEEDBACK_STATE_FILTERS, FEEDBACK_STATES, MAX_FEEDBACK_NOTE_LENGTH, type FeedbackList, type FeedbackState, type FeedbackStateFilter, type FeedbackView } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { feedbackMarks, putFeedbackMark } from '../db'

/** The messages asked of the learner app's server for one page of the tab: one request to it for each page shown. */
export const FEEDBACK_PAGE = 50
/** How long the learner app's server has to answer. */
const TIMEOUT_MS = 10_000

/** The learner app's server and the token it answers to, or null while either setting is missing (spec §16). */
function feedbackSource(deps: Deps): { readonly url: string; readonly token: string } | null {
  const url = (deps.env.LEARNER_APP_URL ?? '').trim()
  const token = (deps.env.FEEDBACK_READ_TOKEN ?? '').trim()
  return url === '' || token === '' ? null : { url, token }
}

/** The learner app's server did not give the feedback: `message` is for the page, and holds nothing of the request. */
class FeedbackUnread extends Error {}

const isText = (v: unknown): v is string => typeof v === 'string'

/** One message as the server sent it, field by field: anything else it may send is not passed on. */
function itemOf(raw: unknown): FeedbackItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const { id, receivedAt, kind, message, contactEmail, signedIn, appVersion, corpusVersion, language, screen, userAgent } = r
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || typeof receivedAt !== 'number' || typeof signedIn !== 'boolean') return null
  if (!(FEEDBACK_KINDS as readonly unknown[]).includes(kind)) return null
  if (!isText(message) || !isText(contactEmail) || !isText(appVersion) || !isText(corpusVersion) || !isText(language) || !isText(screen) || !isText(userAgent)) return null
  return { id, receivedAt, kind: kind as FeedbackKind, message, contactEmail, signedIn, appVersion, corpusVersion, language, screen, userAgent }
}

/** One page of feedback from the learner app's server, newest first: a single request, with the shared token. */
async function readFeedback(deps: Deps, source: { url: string; token: string }, kind: FeedbackKind | null, before: number | null): Promise<{ items: FeedbackItem[]; nextBefore: number | null }> {
  const query = new URLSearchParams({ limit: String(FEEDBACK_PAGE) })
  if (kind !== null) query.set('kind', kind)
  if (before !== null) query.set('before', String(before))
  let res: Response
  try {
    // A redirect is not followed: the token goes to the server it was made for and nowhere else.
    res = await deps.fetch(`${source.url.replace(/\/+$/, '')}/v1/admin/feedback?${query.toString()}`, {
      headers: { authorization: `Bearer ${source.token}`, accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    deps.log(`feedback: the app's server was not reached: ${err instanceof Error ? err.name : 'error'}`)
    throw new FeedbackUnread('The app’s server could not be reached.')
  }
  if (res.status !== 200) {
    deps.log(`feedback: the app's server answered ${res.status}`)
    // To a wrong token the server is a route that does not exist.
    throw new FeedbackUnread(`The app’s server answered ${res.status}.${res.status === 404 ? ' Check that FEEDBACK_READ_TOKEN is the same in both deployments.' : ''}`)
  }
  const body = (await res.json().catch(() => null)) as { items?: unknown; nextBefore?: unknown } | null
  const items = Array.isArray(body?.items) ? body.items.map(itemOf) : null
  const next = body?.nextBefore ?? null
  if (items === null || items.includes(null) || (next !== null && (typeof next !== 'number' || !Number.isSafeInteger(next) || next < 1))) {
    deps.log('feedback: the answer of the app’s server was not a page of feedback')
    throw new FeedbackUnread('The app’s server gave an answer the review app does not understand.')
  }
  return { items: items as FeedbackItem[], nextBefore: next }
}

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
      page = await readFeedback(deps, source, kind as FeedbackKind | null, before)
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
