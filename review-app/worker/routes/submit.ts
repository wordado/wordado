import type { Hono } from 'hono'
import type { SubmissionView } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { getAssignment, listSubmissions, setSubmissionStatus, submissionByPr, unsubmit } from '../db'
import { githubFor, GitHubError, verifyWebhook } from '../github'
import { currentSnapshot } from '../snapshotStore'
import { PrUnconfirmed, settleClaim, submit } from '../submit'
import { NO_SNAPSHOT, ownAssignment, reviewerNames } from './reviewer'

export function submitRoutes(app: Hono<AppEnv>, deps: Deps): void {
  app.post('/api/submit', async (c) => {
    const req = await jsonBody<{ assignment?: unknown }>(c)
    const me = c.get('me')
    const a = await ownAssignment(deps, me.email, Number(req.assignment))
    if (!a) return apiError(c, 403, 'not your assignment')
    const snap = await currentSnapshot(deps)
    const rules = snap?.queue(a.queue)
    if (!rules) return apiError(c, 503, NO_SNAPSHOT)
    const gh = githubFor(deps)
    if (!gh) return apiError(c, 503, 'GitHub is not configured for the review app')
    try {
      const out = await submit(deps, me, a, gh, rules)
      return 'status' in out ? apiError(c, out.status, out.message) : c.json(out)
    } catch (err) {
      deps.log(`submit failed: ${err instanceof Error ? (err instanceof GitHubError || err instanceof PrUnconfirmed ? err.message : (err.stack ?? err.message)) : String(err)}`)
      return c.json({ message: failureMessage(err) }, 502)
    }
  })

  app.post('/api/github/webhook', async (c) => {
    const body = await c.req.text()
    if (!(await verifyWebhook(deps.env.GITHUB_WEBHOOK_SECRET ?? '', body, c.req.header('x-hub-signature-256') ?? null))) return apiError(c, 401, 'bad signature')
    if (c.req.header('x-github-event') !== 'pull_request') return c.body(null, 204)
    const event = JSON.parse(body) as { action?: string; pull_request?: { number?: number; merged?: boolean } }
    if (event.action !== 'closed' || typeof event.pull_request?.number !== 'number') return c.body(null, 204)
    const s = await submissionByPr(deps.env.DB, event.pull_request.number)
    if (s && s.status === 'open') await closeSubmission(deps, s.id, event.pull_request.merged === true)
    return c.body(null, 204)
  })

  app.get('/api/admin/submissions', async (c) => {
    const gh = githubFor(deps)
    for (const s of await listSubmissions(deps.env.DB, { status: 'open' })) {
      if (!gh) continue
      try {
        // A claim with no pull request recorded: complete it from GitHub, or release it when it is stale.
        const pr = s.pr ?? (await settleClaim(deps, gh, s).then((r) => (r.state === 'completed' ? r.pr : null)))
        if (pr === null) continue
        const state = await gh.prState(pr)
        if (state !== 'open') await closeSubmission(deps, s.id, state === 'merged')
      } catch (err) {
        deps.log(`refresh of submission ${s.id} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const names = await reviewerNames(deps)
    const out: SubmissionView[] = []
    for (const s of await listSubmissions(deps.env.DB)) {
      const a = (await getAssignment(deps.env.DB, s.assignment))!
      out.push({ id: s.id, assignment: s.assignment, reviewer: a.reviewer, reviewerName: names.get(a.reviewer) ?? a.reviewer, queue: a.queue, branch: s.branch, pr: s.pr, url: s.url, count: s.count, leftOut: s.leftOut, status: s.status, createdAt: s.createdAt })
    }
    return c.json(out)
  })
}

const SAVED = 'Your decisions are saved; try Submit again.'

/** What the reviewer reads after a failed submit: of the error, only GitHub's status and its own explanation. */
function failureMessage(err: unknown): string {
  if (err instanceof PrUnconfirmed) {
    // The claim is kept (the pull request may exist), so an immediate Submit would be refused.
    const cause = err.cause instanceof GitHubError ? err.cause : null
    const why = cause === null ? '' : cause.status === 0 ? ' (GitHub was not reached)' : ` (${cause.status}${cause.detail ? `: ${cause.detail}` : ''})`
    return `GitHub did not confirm the pull request${why}. Your decisions are saved; try Submit again in a couple of minutes.`
  }
  if (!(err instanceof GitHubError)) return 'The submit failed. Your decisions are saved; try again.'
  if (err.status === 0) return `Could not reach GitHub. ${SAVED}`
  const said = `${err.status}${err.detail ? `: ${err.detail}` : ''}`
  return err.what === 'pull request' ? `GitHub did not accept the pull request (${said}). ${SAVED}` : `GitHub refused the submit (${err.what}, ${said}). ${SAVED}`
}

async function closeSubmission(deps: Deps, id: number, merged: boolean): Promise<void> {
  await setSubmissionStatus(deps.env.DB, id, merged ? 'merged' : 'closed')
  if (!merged) await unsubmit(deps.env.DB, id)
}
