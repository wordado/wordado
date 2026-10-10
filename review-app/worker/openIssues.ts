import type { Deps } from './app'
import type { Env } from './bindings'
import { claimIssuesRead, replaceOpenIssues, settleIssuesRead } from './db'

/** Pages of open issues in one read, 100 issues each. */
export const ISSUE_PAGES = 3
const PAGE = 100
/** The characters of an issue's title that are kept. */
export const MAX_ISSUE_TITLE = 200
/** How long GitHub has to answer one page. */
const TIMEOUT_MS = 10_000

/** The public app repository, `owner/name`, or null when the setting is not one. */
export function appRepo(env: Pick<Env, 'APP_REPO'>): string | null {
  const repo = (env.APP_REPO ?? '').trim()
  const name = /^[A-Za-z0-9_.-]+$/
  const [owner = '', repoName = '', ...more] = repo.split('/')
  return more.length === 0 && name.test(owner) && name.test(repoName) && !/^\.+$/.test(owner) && !/^\.+$/.test(repoName) ? repo : null
}

/** GitHub did not give the issues: `message` is for the log, and holds nothing of an answer. */
class IssuesUnread extends Error {}

/** One issue of GitHub's list: its number and its title on one line. A pull request, which that list holds too, and anything else is not one. */
function issueOf(raw: unknown): { number: number; title: string } | null {
  if (typeof raw !== 'object' || raw === null || 'pull_request' in raw) return null
  const { number, title } = raw as Record<string, unknown>
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1 || typeof title !== 'string') return null
  const line = title.replace(/\s+/g, ' ').trim().slice(0, MAX_ISSUE_TITLE)
  return line === '' ? null : { number, title: line }
}

/**
 * The timed job (spec 2026-10-10 §3.3): reads the numbers and titles of the open issues of the public app repository
 * from GitHub's public API, and puts them in place of what was kept. They are public: no token is sent, and none is
 * needed. GitHub allows few such requests an hour from one address, and a Worker shares its addresses with others,
 * so a refused read is expected now and then: what is kept stays, and the AI proposes no match once it is two days
 * old. One read a UTC day at most, taken in the database before anything is asked, and never a second try. Never
 * throws. What is logged of a failure is a status or an error's name.
 */
export async function refreshOpenIssues(deps: Deps): Promise<'read' | 'failed' | 'no-repo' | 'already'> {
  const repo = appRepo(deps.env)
  if (!repo) {
    deps.log('open issues: not read, APP_REPO is not set to owner/name')
    return 'no-repo'
  }
  try {
    if (!(await claimIssuesRead(deps.env.DB, deps.now()))) {
      deps.log('open issues: already read today')
      return 'already'
    }
  } catch (err) {
    deps.log(`open issues: not read, ${err instanceof Error ? err.name : 'error'}`)
    return 'failed'
  }
  const day = deps.now()
  try {
    const api = (deps.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '')
    const issues = new Map<number, string>()
    for (let page = 1; page <= ISSUE_PAGES; page += 1) {
      // A redirect is not followed: a repository that moved is to be named anew in APP_REPO.
      const res = await deps.fetch(`${api}/repos/${repo}/issues?state=open&per_page=${PAGE}&page=${page}`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'wordado-review' },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (res.status !== 200) throw new IssuesUnread(`GitHub answered ${res.status}`)
      const body: unknown = await res.json().catch(() => null)
      if (!Array.isArray(body)) throw new IssuesUnread('the answer was not a list of issues')
      for (const raw of body) {
        const issue = issueOf(raw)
        if (issue) issues.set(issue.number, issue.title)
      }
      if (body.length < PAGE) break
    }
    await replaceOpenIssues(deps.env.DB, [...issues].map(([number, title]) => ({ number, title })), deps.now().toISOString())
    await settleIssuesRead(deps.env.DB, day, 'read')
    deps.log(`open issues: ${issues.size} read`)
    return 'read'
  } catch (err) {
    deps.log(`open issues: not read, ${err instanceof IssuesUnread ? err.message : err instanceof Error ? err.name : 'error'}`)
    await settleIssuesRead(deps.env.DB, day, 'failed').catch(() => undefined)
    return 'failed'
  }
}
