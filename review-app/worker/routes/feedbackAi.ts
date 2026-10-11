import { FEEDBACK_KINDS, type FeedbackKind } from '@wordado/core'
import type { Context, Hono } from 'hono'
import type { FeedbackWeek, FeedbackWeekParagraph } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { forgetFeedbackAi, putSetting, weekText } from '../db'
import { AI_SWITCH, aiStatus, readPageAi } from '../feedbackAi'
import { aiSetup } from '../feedbackAiConfig'
import { tabWeek, weekNumbers, weekParagraph } from '../feedbackWeek'
import { FeedbackUnread, feedbackSource } from '../learnerApp'

/** The first key of a body that is not one of `known`, if it has any. */
const extraKey = (body: Record<string, unknown>, known: readonly string[]) => Object.keys(body).find((key) => !known.includes(key))

/** What the AI's routes answer is of the moment: nothing between the Worker and the page keeps it. */
const fresh = (c: Context) => c.header('cache-control', 'no-store')

/**
 * The AI help on the Feedback tab (spec 2026-10-10): its switch, the reading of a page, the week in numbers with
 * its paragraph, and forgetting what it wrote. Registered after adminRoutes, so every route is behind the admin-only middleware, and before
 * feedbackRoutes: `PUT /api/admin/feedback/ai` must not be taken for the mark of a message called "ai".
 */
export function feedbackAiRoutes(app: Hono<AppEnv>, deps: Deps): void {
  app.get('/api/admin/feedback/ai', async (c) => {
    fresh(c)
    return c.json(await aiStatus(deps))
  })

  /** The switch. On is refused while the help is not set up, with the name of the setting it needs; off is always taken. It is kept with who set it and when. */
  app.put('/api/admin/feedback/ai', async (c) => {
    fresh(c)
    const body = await jsonBody<Record<string, unknown>>(c)
    const extra = extraKey(body, ['on'])
    if (extra !== undefined) return apiError(c, 400, `the switch is on or off, and has no ${extra}`)
    if (typeof body['on'] !== 'boolean') return apiError(c, 400, 'on must be true or false')
    const { needs } = aiSetup(deps.env)
    if (body['on'] && needs !== null) return apiError(c, 409, `AI help is not set up: set ${needs} for the review app.`)
    await putSetting(deps.env.DB, AI_SWITCH, body['on'] ? 'on' : 'off', c.get('me').email, deps.now().toISOString())
    return c.json(await aiStatus(deps))
  })

  /**
   * Asks the AI about one page of the tab. The body names the page as the list's query does, and never holds a
   * message: the Worker reads the page itself from the learner app's server, so what goes to the model is what
   * that server gave and nothing a browser sent.
   */
  app.post('/api/admin/feedback/ai/read', async (c) => {
    fresh(c)
    const body = await jsonBody<Record<string, unknown>>(c)
    const { kind, before } = body
    const extra = extraKey(body, ['kind', 'before'])
    if (extra !== undefined) return apiError(c, 400, `a page has a kind and a before, and no ${extra}`)
    if (kind !== '' && !(FEEDBACK_KINDS as readonly unknown[]).includes(kind)) return apiError(c, 400, `kind must be empty or one of ${FEEDBACK_KINDS.join(', ')}`)
    if (before !== null && (typeof before !== 'number' || !Number.isSafeInteger(before) || before < 1)) return apiError(c, 400, 'before must be the id of a message, or null')
    const source = feedbackSource(deps)
    if (!source) return apiError(c, 409, 'Feedback is not connected.')
    try {
      return c.json(await readPageAi(deps, source, { kind: kind === '' ? null : (kind as FeedbackKind), before }))
    } catch (err) {
      if (err instanceof FeedbackUnread) return apiError(c, 502, err.message)
      throw err
    }
  })

  /** The last seven days in numbers (spec 2026-10-10 §3.4), from the database alone, with the day's paragraph when one is kept. Nobody is asked. */
  app.get('/api/admin/feedback/week', async (c) => {
    fresh(c)
    const period = tabWeek(deps.now())
    const [numbers, paragraph] = await Promise.all([weekNumbers(deps.env.DB, period), weekText(deps.env.DB, period.key)])
    return c.json({ ...numbers, paragraph } satisfies FeedbackWeek)
  })

  /**
   * The paragraph about the last seven days: the one kept for this UTC day, or one call to the model, which is
   * given the numbers and the topics' titles and nothing a learner wrote. The body is empty: the Worker counts the
   * week itself, so nothing a browser sent goes to the model.
   */
  app.post('/api/admin/feedback/week/paragraph', async (c) => {
    fresh(c)
    const body = await jsonBody<Record<string, unknown>>(c)
    const extra = extraKey(body, [])
    if (extra !== undefined) return apiError(c, 400, `the week's paragraph takes no ${extra}`)
    const period = tabWeek(deps.now())
    return c.json((await weekParagraph(deps, period.key, await weekNumbers(deps.env.DB, period))) satisfies FeedbackWeekParagraph)
  })

  /** Forget the AI's results: everything it wrote about the feedback, the week's paragraphs with it. The marks, the switch and the day's count of calls stay. */
  app.delete('/api/admin/feedback/ai/results', async (c) => {
    fresh(c)
    const body = await jsonBody<Record<string, unknown>>(c)
    const extra = extraKey(body, [])
    if (extra !== undefined) return apiError(c, 400, `forgetting takes no ${extra}`)
    return c.json({ forgotten: await forgetFeedbackAi(deps.env.DB) })
  })
}
