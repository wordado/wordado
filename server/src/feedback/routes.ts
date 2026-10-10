import { isFeedbackTrap, parseFeedback } from '@wordado/core'
import type { Hono, MiddlewareHandler } from 'hono'
import type { ServerDeps } from '../deps'
import { EXPECTED_USER_HEADER, invalid, readJson, type AppEnv } from '../http'
import { feedbackClient, takeFeedbackPlace } from './limit'

/** `session` is `optionalUser`: the sender's account when there is one, and nobody otherwise. */
export function feedbackRoutes(app: Hono<AppEnv>, deps: ServerDeps, session: MiddlewareHandler<AppEnv>): void {
  /**
   * Feedback about the app (spec §8.12), from anyone: signed in or not, and
   * later from the website's form. It is limited per client and in all
   * (src/feedback/limit.ts). A body with the hidden field filled in came
   * from a program: it is answered like any other and kept nowhere.
   */
  app.post('/v1/feedback', session, async (c) => {
    const body = await readJson(c)
    if (isFeedbackTrap(body)) return c.json({ ok: true })
    const parsed = parseFeedback(body)
    if (!parsed.ok) return invalid(c, parsed.errors)
    const f = parsed.value
    // Only whether the sender was signed in is kept, never who (#166). A session that is not the learner the
    // client names is someone else's: the message counts as sent signed out.
    const sessionUser: string | undefined = c.get('userId')
    const expected = c.req.header(EXPECTED_USER_HEADER)
    const signedIn = sessionUser !== undefined && (expected === undefined || expected === sessionUser)
    const client = await feedbackClient(deps.config.authSecret, c.req.header('cf-connecting-ip'))
    const now = deps.now()
    const kept = await deps.db.transaction(async (tx) => {
      if (!(await takeFeedbackPlace(tx, client, now))) return false
      await tx.query(
        `insert into feedback (signed_in, kind, message, contact_email, app_version, corpus_version, user_agent, language, screen, received_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [signedIn, f.kind, f.message, f.email, f.appVersion, f.corpusVersion, f.userAgent, f.language, f.screen, now],
      )
      return true
    })
    if (!kept) return c.json({ error: 'feedback_limit' }, 429)
    return c.json({ ok: true })
  })
}
