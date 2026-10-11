import type { Context, Hono } from 'hono'
import { FEEDBACK_STATES, MAX_FEEDBACK_NOTE_LENGTH, MAX_TOPIC_TITLE_LENGTH, MIN_TOPIC_TITLE_LENGTH, type FeedbackState, type FeedbackTopicOpened, type FeedbackView } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { dropFeedbackAi, feedbackAiRows, feedbackMarks, getTopic, listTopics, markTopicMessagesDone, mergeTopics, moveFeedbackToTopic, putTopic, setTopicIssue, topicFeedbackIds } from '../db'
import { aiView } from '../feedbackAi'
import { draftIssue } from '../feedbackDraft'
import { FeedbackUnread, feedbackSource, readFeedback } from '../learnerApp'
import { topicTitle } from '../topicTitle'

/** The messages of a topic that are read when it is opened: its newest, in one request to the learner app's server. */
export const TOPIC_PAGE = 50
/** The highest number an issue is taken to have. */
const MAX_ISSUE_NUMBER = 2_147_483_647

/** The id of a topic or of a message in an address: a whole number from 1 up. */
const idOf = (raw: string): number | null => (/^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : null)
/** An id in a body: a whole number from 1 up, as a number. */
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1
/** The first key of a body that is not one of `known`, if it has any. */
const extraKey = (body: Record<string, unknown>, known: readonly string[]) => Object.keys(body).find((key) => !known.includes(key))
/** What these routes answer is of the moment: nothing between the Worker and the page keeps it. */
const fresh = (c: Context) => c.header('cache-control', 'no-store')

/**
 * The Feedback tab by topic (spec 2026-10-10 §3.2, §3.3): the list, a topic's messages, and what the coordinator
 * does with a topic: rename it, mark it, merge it into another, move a message to it, and confirm or remove its
 * match with a known issue. All of it is the coordinator's own doing: none of these routes asks the model, and the
 * only request that leaves the Worker is the read of a topic's messages from the learner app's server. The one
 * exception is the draft of an issue (§3.5), which reads the topic's messages and asks the model once; it changes
 * nothing, and nothing is written to GitHub by any route.
 * Registered after adminRoutes, so every route is behind the admin-only middleware, and before feedbackRoutes:
 * `PUT /api/admin/feedback/topics` must not be taken for the mark of a message.
 */
export function feedbackTopicsRoutes(app: Hono<AppEnv>, deps: Deps): void {
  /** One line a topic, from the database alone. */
  app.get('/api/admin/feedback/topics', async (c) => {
    fresh(c)
    return c.json(await listTopics(deps.env.DB))
  })

  /**
   * A topic opened: its newest messages, read from the learner app's server by their ids in one request, each with
   * its mark and its reading as the list of messages gives them. A reading whose message that server no longer has
   * is dropped, as the list drops it (spec 2026-10-10 §4), but only when the server answered by id: one from before
   * `ids` gives its newest page instead, and then nothing is dropped and the answer says it is incomplete.
   */
  app.get('/api/admin/feedback/topics/:id', async (c) => {
    fresh(c)
    const id = idOf(c.req.param('id'))
    if (id === null) return apiError(c, 400, 'that is not the id of a topic')
    const topic = await getTopic(deps.env.DB, id)
    if (!topic) return apiError(c, 404, 'no such topic')
    const { ids, total } = await topicFeedbackIds(deps.env.DB, id, TOPIC_PAGE)
    if (ids.length === 0) return c.json({ topic, items: [], more: 0, incomplete: false } satisfies FeedbackTopicOpened)
    const source = feedbackSource(deps)
    if (!source) return apiError(c, 409, 'Feedback is not connected.')
    let page: Awaited<ReturnType<typeof readFeedback>>
    try {
      page = await readFeedback(deps, source, { limit: TOPIC_PAGE, ids })
    } catch (err) {
      if (err instanceof FeedbackUnread) return apiError(c, 502, err.message)
      throw err
    }
    // Asked by id, a server gives nothing else and has no older page to name.
    const incomplete = page.others > 0 || page.nextBefore !== null
    const given = new Set(page.items.map((item) => item.id))
    const gone = incomplete ? [] : ids.filter((one) => !given.has(one))
    if (gone.length > 0) await dropFeedbackAi(deps.env.DB, gone)
    const shown = page.items.map((item) => item.id)
    const [marks, readings] = await Promise.all([feedbackMarks(deps.env.DB, shown), feedbackAiRows(deps.env.DB, shown)])
    const items: FeedbackView[] = page.items.map((item) => {
      const mark = marks.get(item.id)
      const ai = readings.get(item.id)
      return { ...item, state: mark?.state ?? 'new', note: mark?.note ?? '', markedAt: mark?.updatedAt ?? null, ai: ai ? aiView(ai) : null }
    })
    // Counted again when readings were dropped, so the line above the messages says what is under it.
    const now = gone.length > 0 ? ((await getTopic(deps.env.DB, id)) ?? topic) : topic
    return c.json({ topic: now, items, more: Math.max(0, total - ids.length), incomplete } satisfies FeedbackTopicOpened)
  })

  /**
   * Sets a topic's title, state and note, all three each time. A title another topic has is refused: two topics
   * about one thing are merged. A topic that becomes Done marks its messages done (spec 2026-10-10 §3.2), those
   * that have a reading, each keeping its note; Not doing marks none, and a topic that is Done already marks none again.
   */
  app.put('/api/admin/feedback/topics/:id', async (c) => {
    fresh(c)
    const id = idOf(c.req.param('id'))
    if (id === null) return apiError(c, 400, 'that is not the id of a topic')
    const body = await jsonBody<Record<string, unknown>>(c)
    const { state, note } = body
    const extra = extraKey(body, ['title', 'state', 'note'])
    if (extra !== undefined) return apiError(c, 400, `a topic has a title, a state and a note, and no ${extra}`)
    const title = topicTitle(body['title'])
    if (title === null) return apiError(c, 400, `title must be one line of ${MIN_TOPIC_TITLE_LENGTH} to ${MAX_TOPIC_TITLE_LENGTH} characters, with no address, link or phone number in it`)
    if (!(FEEDBACK_STATES as readonly unknown[]).includes(state)) return apiError(c, 400, `state must be one of ${FEEDBACK_STATES.join(', ')}`)
    if (typeof note !== 'string' || note.length > MAX_FEEDBACK_NOTE_LENGTH) return apiError(c, 400, `note must be text of at most ${MAX_FEEDBACK_NOTE_LENGTH} characters`)
    const before = await getTopic(deps.env.DB, id)
    if (!before) return apiError(c, 404, 'no such topic')
    const by = c.get('me').email
    const at = deps.now().toISOString()
    const put = await putTopic(deps.env.DB, id, { title, state: state as FeedbackState, note: note.trim() }, by, at)
    if (put === 'missing') return apiError(c, 404, 'no such topic')
    if (put === 'title-taken') return apiError(c, 409, 'Another topic has this title. Merge the two instead.')
    const marked = state === 'done' && before.state !== 'done' ? await markTopicMessagesDone(deps.env.DB, id, by, at) : 0
    const topic = await getTopic(deps.env.DB, id)
    if (!topic) return apiError(c, 404, 'no such topic')
    return c.json({ topic, marked })
  })

  /** Merges this topic into another: its messages, its note and, when the other has none, its match go over, and it is gone. Answers the other topic. */
  app.post('/api/admin/feedback/topics/:id/merge', async (c) => {
    fresh(c)
    const id = idOf(c.req.param('id'))
    if (id === null) return apiError(c, 400, 'that is not the id of a topic')
    const body = await jsonBody<Record<string, unknown>>(c)
    const { into } = body
    const extra = extraKey(body, ['into'])
    if (extra !== undefined) return apiError(c, 400, `a merge names the topic to merge into, and no ${extra}`)
    if (!isId(into)) return apiError(c, 400, 'into must be the id of a topic')
    if (into === id) return apiError(c, 400, 'a topic cannot be merged into itself')
    if ((await mergeTopics(deps.env.DB, id, into, c.get('me').email, deps.now().toISOString())) === 'missing') return apiError(c, 404, 'no such topic')
    const topic = await getTopic(deps.env.DB, into)
    return topic ? c.json(topic) : apiError(c, 404, 'no such topic')
  })

  /** The coordinator moves a message to a topic. No later reading of the AI's moves it again. */
  app.put('/api/admin/feedback/:id/topic', async (c) => {
    fresh(c)
    const id = idOf(c.req.param('id'))
    if (id === null) return apiError(c, 400, 'that is not the id of a message')
    const body = await jsonBody<Record<string, unknown>>(c)
    const { topic } = body
    const extra = extraKey(body, ['topic'])
    if (extra !== undefined) return apiError(c, 400, `a move names the topic, and no ${extra}`)
    if (!isId(topic)) return apiError(c, 400, 'topic must be the id of a topic')
    if ((await moveFeedbackToTopic(deps.env.DB, id, topic)) === 'missing') return apiError(c, 404, 'The message has no AI result yet, or there is no such topic.')
    const now = (await feedbackAiRows(deps.env.DB, [id])).get(id)
    return c.json({ id, topic: now ? aiView(now).topic : null })
  })

  /**
   * Drafts an issue for a topic (spec 2026-10-10 §3.5): one read of its newest messages, one call to the model. The
   * body is empty: the Worker reads the messages itself, so what goes to the model is what the learner app's server
   * gave and nothing a browser sent. The draft is answered and kept nowhere; filing it is the coordinator's, in
   * their own browser, under their own name.
   */
  app.post('/api/admin/feedback/topics/:id/draft', async (c) => {
    fresh(c)
    const id = idOf(c.req.param('id'))
    if (id === null) return apiError(c, 400, 'that is not the id of a topic')
    const body = await jsonBody<Record<string, unknown>>(c)
    const extra = extraKey(body, [])
    if (extra !== undefined) return apiError(c, 400, `a draft is asked for with nothing, and no ${extra}`)
    const topic = await getTopic(deps.env.DB, id)
    if (!topic) return apiError(c, 404, 'no such topic')
    const source = feedbackSource(deps)
    if (!source) return apiError(c, 409, 'Feedback is not connected.')
    try {
      return c.json(await draftIssue(deps, source, topic))
    } catch (err) {
      if (err instanceof FeedbackUnread) return apiError(c, 502, err.message)
      throw err
    }
  })

  /** The coordinator's answer on a topic's match with a known issue: a number confirms it (one the AI proposed, or one they typed); null removes it, and the AI proposes none for the topic again. */
  app.put('/api/admin/feedback/topics/:id/issue', async (c) => {
    fresh(c)
    const id = idOf(c.req.param('id'))
    if (id === null) return apiError(c, 400, 'that is not the id of a topic')
    const body = await jsonBody<Record<string, unknown>>(c)
    const extra = extraKey(body, ['issue'])
    if (extra !== undefined) return apiError(c, 400, `a match has an issue, and no ${extra}`)
    if (!('issue' in body)) return apiError(c, 400, 'issue must be the number of an issue, or null')
    const { issue } = body
    if (issue !== null && (!isId(issue) || issue > MAX_ISSUE_NUMBER)) return apiError(c, 400, 'issue must be the number of an issue, or null')
    if (!(await setTopicIssue(deps.env.DB, id, issue, issue === null ? 'removed' : 'confirmed', c.get('me').email, deps.now().toISOString()))) return apiError(c, 404, 'no such topic')
    const topic = await getTopic(deps.env.DB, id)
    return topic ? c.json(topic) : apiError(c, 404, 'no such topic')
  })
}
