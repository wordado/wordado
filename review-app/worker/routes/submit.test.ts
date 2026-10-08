import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { csvRecords } from '@wordado/pipeline/csv'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { RowsResponse, SubmissionView, SubmitResult } from '../../shared/hosted'
import { createApp, type Deps } from '../app'
import type { Env } from '../bindings'
import { insertAssignment, insertReviewer, insertSubmission, listDecisions, listSubmissions, markSubmitted } from '../db'
import { resetGitHubTokens } from '../github'
import { resetSnapshotCache } from '../snapshotStore'
import { branchSlug } from '../submit'
import { FakeGitHub, testAppKey } from '../test/fakeGitHub'
import { testKeys } from '../test/jwt'
import { resetDb, startPlatform, testDeps } from '../test/platform'
import { putSnapshot } from '../test/snapshot'

let env: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
let pem: string
let id: number
let fake: FakeGitHub
let deps: Deps
let mails: { to: string[] }[] = []
let failGitHub = false
let logs: string[] = []
let sleeps: number[] = []
/** Answers for the next calls that open a pull request, in place of the fake's; 'after' lets the fake open it first. */
let pullAnswers: { res: () => Response; after?: boolean }[] = []
let pullCalls = 0

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
}

beforeAll(async () => {
  keys = await testKeys()
  pem = (await testAppKey()).pem
  const p = await startPlatform()
  env = { ...p.env, ACCESS_JWKS: keys.jwks, GITHUB_APP_PRIVATE_KEY: pem, GITHUB_API_URL: 'https://api.github.test', GITHUB_WEBHOOK_SECRET: 's3cret', RESEND_API_KEY: 're_test' }
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(async () => {
  await resetDb(env.DB)
  resetSnapshotCache()
  resetGitHubTokens()
  const { content } = await putSnapshot(env)
  const files: Record<string, string> = {}
  for (const path of walk(join(content, 'review'))) files[relative(content, path).split('\\').join('/')] = readFileSync(path, 'utf8')
  fake = new FakeGitHub(files)
  mails = []
  failGitHub = false
  logs = []
  sleeps = []
  pullAnswers = []
  pullCalls = 0
  deps = testDeps(env, {
    log: (line) => logs.push(line),
    sleep: async (ms) => void sleeps.push(ms),
    fetch: async (input, init) => {
      if (input.startsWith('https://api.github.test/')) {
        if (failGitHub) return new Response('{"message":"down"}', { status: 500 })
        if (init?.method === 'POST' && input.endsWith('/pulls')) {
          pullCalls += 1
          const answer = pullAnswers.shift()
          if (answer?.after) await fake.fetch(input.replace('https://api.github.test', 'https://x'), init)
          if (answer) return answer.res()
        }
        return fake.fetch(input.replace('https://api.github.test', 'https://x'), init)
      }
      if (input.startsWith('https://api.resend.com/')) {
        mails.push({ to: (JSON.parse(String(init?.body)) as { to: string[] }).to })
        return new Response('{}', { status: 200 })
      }
      return new Response(`no fake for ${input}`, { status: 599 })
    },
  })
  await insertReviewer(env.DB, { email: 'ivan@example.com', name: 'Ivan', languages: ['bg', 'en'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
  await insertReviewer(env.DB, { email: 'admin@example.com', name: 'Coordinator', languages: ['bg', 'de', 'es', 'en'], role: 'admin', invitedAt: 't', inviteSentAt: null, disabledAt: null })
  id = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true, createdAt: 't' })
})

const as = async (email: string, method: 'GET' | 'POST', path: string, body?: unknown) =>
  createApp(deps).request(path, {
    method,
    headers: {
      'cf-access-jwt-assertion': await keys.token(email, env),
      ...(body !== undefined ? { origin: env.APP_ORIGIN, 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

async function decideFirst(n: number): Promise<RowsResponse['rows']> {
  const rows = ((await (await as('ivan@example.com', 'GET', `/api/rows?assignment=${id}`)).json()) as RowsResponse).rows.slice(0, n)
  expect(rows).toHaveLength(n)
  for (const r of rows) {
    const res = await as('ivan@example.com', 'POST', '/api/decision', { assignment: id, queue: r.queue, file: r.file, key: r.key, rowHash: r.rowHash, action: 'keep' })
    expect(res.status).toBe(200)
  }
  return rows
}

describe('branchSlug', () => {
  it('is lowercase ASCII from the name, else the email, else reviewer', () => {
    expect(branchSlug('Ivan Petrov', 'x@example.com')).toBe('ivan-petrov')
    expect(branchSlug('Анна', 'anna.k@example.com')).toBe('anna-k')
    expect(branchSlug('***', '!!@example.com')).toBe('reviewer')
  })
})

describe('POST /api/submit', () => {
  it('commits the decisions into the review files on one branch and opens a pull request', async () => {
    const rows = await decideFirst(2)
    const res = await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })
    expect(res.status).toBe(200)
    const out = (await res.json()) as SubmitResult
    expect(out).toMatchObject({ pr: 1, count: 2, leftOut: [] })
    const pr = fake.pulls[0]!
    expect(pr.title).toBe('translation-bg: 2 decisions by Ivan')
    expect(pr.head).toBe('review/translation-bg-ivan-20261005-1')
    const commit = fake.commits.get(fake.branches.get(pr.head)!)!
    expect(commit.message).toBe('review: translation-bg, 2 decisions by Ivan')
    expect(commit.author.name).toBe('Ivan')
    const text = commit.files.get(rows[0]!.file)!
    expect(csvRecords(text).rows.find((r) => r['key'] === rows[0]!.key)!['verdict']).toBe('ok')
    expect(mails.some((m) => m.to.includes('admin@example.com'))).toBe(true)
    const after = ((await (await as('ivan@example.com', 'GET', `/api/rows?assignment=${id}`)).json()) as RowsResponse).rows
    expect(after.find((r) => r.key === rows[0]!.key)!.decision!.submission).not.toBeNull()
  })

  it('leaves out a row whose proposal changed on main and submits the rest', async () => {
    const rows = await decideFirst(2)
    const sidecarPath = rows[0]!.file.replace(/\.csv$/, '.json')
    const sidecar = JSON.parse(fake.files.get(sidecarPath)!) as { items: { key: string; proposed: unknown }[] }
    sidecar.items = sidecar.items.map((i) => (i.key === rows[0]!.key ? { ...i, proposed: { changed: true } } : i))
    fake.pushToMain(sidecarPath, JSON.stringify(sidecar))
    const out = (await (await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).json()) as SubmitResult
    expect(out.count).toBe(1)
    expect(out.leftOut).toEqual([{ key: rows[0]!.key, reason: 'changed' }])
  })

  it('uses the next branch number when the branch exists, and the email for a non-ASCII name', async () => {
    await env.DB.prepare('UPDATE reviewers SET name = ? WHERE email = ?').bind('Анна "Ани" Петрова', 'ivan@example.com').run()
    fake.branches.set('review/translation-bg-ivan-20261005-1', 'sha-main')
    await decideFirst(1)
    const out = (await (await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).json()) as SubmitResult
    expect(fake.pulls.at(-1)!.head).toBe('review/translation-bg-ivan-20261005-2')
    expect(fake.commits.get(fake.branches.get('review/translation-bg-ivan-20261005-2')!)!.author.name).toBe('Анна "Ани" Петрова')
    expect(out.count).toBe(1)
  })

  it('is 400 with nothing to submit, and 502 with nothing recorded when GitHub fails', async () => {
    expect((await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).status).toBe(400)
    await decideFirst(1)
    failGitHub = true
    expect((await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).status).toBe(502)
    expect(await listSubmissions(env.DB)).toHaveLength(0)
    expect((await listDecisions(env.DB, id)).every((d) => d.submission === null)).toBe(true)
  })
})

describe('one submit at a time (the claim)', () => {
  /** A claim as a submit leaves it before its pull request is recorded: pr null, the decisions marked with it. */
  async function pendingClaim(branch: string, createdAt: string, n = 1): Promise<number> {
    const rows = await decideFirst(n)
    const claim = await insertSubmission(env.DB, { assignment: id, branch, pr: null, url: null, count: n, leftOut: 0, status: 'open', createdAt })
    await markSubmitted(env.DB, id, rows.map((r) => r.key), claim)
    return claim
  }

  it('two submits at once open one pull request; the other is refused', async () => {
    await decideFirst(2)
    const both = await Promise.all([as('ivan@example.com', 'POST', '/api/submit', { assignment: id }), as('ivan@example.com', 'POST', '/api/submit', { assignment: id })])
    expect(both.map((r) => r.status).sort()).toEqual([200, 409])
    const refused = both.find((r) => r.status === 409)!
    expect(((await refused.json()) as { message: string }).message).toMatch(/already in progress/)
    expect(fake.pulls).toHaveLength(1)
    expect(await listSubmissions(env.DB)).toHaveLength(1)
  })

  it('releases the claim when GitHub fails before the pull request, so a retry is clean', async () => {
    await decideFirst(1)
    failGitHub = true
    expect((await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).status).toBe(502)
    expect(await listSubmissions(env.DB)).toHaveLength(0)
    failGitHub = false
    expect((await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).status).toBe(200)
    expect(fake.pulls).toHaveLength(1)
  })

  it('a claim whose pull request exists on GitHub is completed, not submitted again', async () => {
    const claim = await pendingClaim('review/translation-bg-ivan-20261005-1', '2026-10-05T11:59:30Z')
    fake.branches.set('review/translation-bg-ivan-20261005-1', fake.mainSha)
    fake.pulls.push({ number: 1, title: 't', head: 'review/translation-bg-ivan-20261005-1', body: '', state: 'open', merged: false })
    const res = await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ pr: 1, url: 'https://github.com/wordado/wordado-content/pull/1', count: 1 })
    expect(fake.pulls).toHaveLength(1)
    expect(await listSubmissions(env.DB)).toMatchObject([{ id: claim, pr: 1, status: 'open' }])
  })

  it('a fresh claim with no pull request yet means a submit is still running', async () => {
    await pendingClaim('review/translation-bg-ivan-20261005-1', '2026-10-05T11:59:30Z')
    expect((await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).status).toBe(409)
    expect(fake.pulls).toHaveLength(0)
  })

  it('a stale claim with no pull request is released and the decisions go out', async () => {
    await pendingClaim('review/translation-bg-ivan-20261005-1', '2026-10-05T11:50:00Z')
    const res = await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })
    expect(res.status).toBe(200)
    expect(((await res.json()) as SubmitResult).count).toBe(1)
    expect(fake.pulls).toHaveLength(1)
    const subs = await listSubmissions(env.DB)
    expect(subs).toHaveLength(1)
    expect(subs[0]!.pr).toBe(1)
  })

  it('the admin list repairs claims too', async () => {
    await pendingClaim('review/translation-bg-ivan-20261005-1', '2026-10-05T11:50:00Z')
    const list = (await (await as('admin@example.com', 'GET', '/api/admin/submissions')).json()) as SubmissionView[]
    expect(list).toHaveLength(0)
    expect((await listDecisions(env.DB, id)).every((d) => d.submission === null)).toBe(true)
  })
})

describe('when GitHub does not open the pull request', () => {
  const BRANCH = 'review/translation-bg-ivan-20261005-1'
  const refused = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ res: () => new Response(JSON.stringify(body), { status, headers }) })
  const submitNow = () => as('ivan@example.com', 'POST', '/api/submit', { assignment: id })
  const reviewBranches = () => [...fake.branches.keys()].filter((b) => b.startsWith('review/'))
  const messageOf = async (res: Response) => ((await res.json()) as { message: string }).message

  it('tries once more after a 502: one pull request, one submission, the decisions marked', async () => {
    await decideFirst(2)
    pullAnswers = [refused(502, { message: 'Server Error' })]
    const res = await submitNow()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ pr: 1, count: 2 })
    expect(sleeps).toEqual([2000])
    expect(pullCalls).toBe(2)
    expect(fake.pulls).toHaveLength(1)
    expect(await listSubmissions(env.DB)).toMatchObject([{ branch: BRANCH, pr: 1 }])
    expect((await listDecisions(env.DB, id)).every((d) => d.submission !== null)).toBe(true)
  })

  it('uses the pull request a failed call opened after all, instead of asking again', async () => {
    await decideFirst(1)
    pullAnswers = [{ ...refused(502, { message: 'Server Error' }), after: true }]
    expect(await (await submitNow()).json()).toMatchObject({ pr: 1 })
    expect(pullCalls).toBe(1)
    expect(fake.pulls).toHaveLength(1)
  })

  it('completes with the pull request found for the branch after a 422', async () => {
    await decideFirst(1)
    pullAnswers = [{ ...refused(422, { message: 'Validation Failed', errors: [{ message: `A pull request already exists for wordado:${BRANCH}.` }] }), after: true }]
    const res = await submitNow()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ pr: 1, url: 'https://github.com/wordado/wordado-content/pull/1' })
    expect(sleeps).toEqual([])
    expect(await listSubmissions(env.DB)).toMatchObject([{ branch: BRANCH, pr: 1 }])
  })

  it('does not retry a 422 with no pull request, or a 403 that is not a rate limit; it says what GitHub said', async () => {
    await decideFirst(1)
    pullAnswers = [refused(422, { message: 'Validation Failed', errors: [{ code: 'custom', message: 'No commits between main and the branch' }] })]
    const res = await submitNow()
    expect(res.status).toBe(502)
    expect(await messageOf(res)).toBe('GitHub did not accept the pull request (422: Validation Failed: No commits between main and the branch). Your decisions are saved; try Submit again.')
    pullAnswers = [refused(403, { message: 'Resource not accessible by integration' })]
    expect((await submitNow()).status).toBe(502)
    expect(pullCalls).toBe(2)
    expect(sleeps).toEqual([])
    expect(await listSubmissions(env.DB)).toHaveLength(0)
  })

  it('waits as long as a rate limit asks when that is short, and does not retry when it is long', async () => {
    await decideFirst(1)
    pullAnswers = [refused(403, { message: 'You have exceeded a secondary rate limit.' }, { 'retry-after': '60' })]
    expect((await submitNow()).status).toBe(502)
    expect(sleeps).toEqual([])
    pullAnswers = [refused(403, { message: 'You have exceeded a secondary rate limit.' }, { 'retry-after': '3' })]
    expect((await submitNow()).status).toBe(200)
    expect(sleeps).toEqual([3000])
    expect(fake.pulls).toHaveLength(1)
  })

  it('tries once more when GitHub could not be reached, and says so without the error’s text when it fails again', async () => {
    await decideFirst(1)
    const unreachable = { res: (): Response => { throw new TypeError('connect ECONNRESET 10.0.0.1') } }
    pullAnswers = [unreachable, unreachable]
    const res = await submitNow()
    expect(res.status).toBe(502)
    expect(await messageOf(res)).toBe('Could not reach GitHub. Your decisions are saved; try Submit again.')
    pullAnswers = [unreachable]
    expect((await submitNow()).status).toBe(200)
    expect(sleeps).toEqual([2000, 2000])
  })

  it('after two failures releases the claim, keeps the decisions pending, tells the reviewer GitHub’s detail and logs it', async () => {
    await decideFirst(2)
    pullAnswers = [refused(502, { message: 'Server Error' }), refused(502, { message: 'Server Error' })]
    const res = await submitNow()
    expect(res.status).toBe(502)
    expect(await messageOf(res)).toBe('GitHub did not accept the pull request (502: Server Error). Your decisions are saved; try Submit again.')
    expect(pullCalls).toBe(2)
    expect(fake.pulls).toHaveLength(0)
    expect(await listSubmissions(env.DB)).toHaveLength(0)
    expect((await listDecisions(env.DB, id)).every((d) => d.submission === null)).toBe(true)
    expect(logs).toContain(`submit of assignment ${id} failed at pull request: branch ${BRANCH}, status 502, Server Error`)
    expect(logs.join('\n')).not.toMatch(/inst-token|Bearer/)
  })

  describe('the branch a failed submit left behind', () => {
    /** A submit whose commit is written and whose pull request is refused: the branch stays, the claim is released. */
    async function failedSubmit(n = 1): Promise<void> {
      await decideFirst(n)
      pullAnswers = [refused(422, { message: 'Validation Failed' })]
      expect((await submitNow()).status).toBe(502)
      expect(fake.pulls).toHaveLength(0)
    }

    it('is used again when it holds exactly this submit: no second branch, no new commit', async () => {
      await failedSubmit(2)
      const commits = fake.commits.size
      const res = await submitNow()
      expect(res.status).toBe(200)
      expect(fake.pulls).toMatchObject([{ number: 1, head: BRANCH }])
      expect(reviewBranches()).toEqual([BRANCH])
      expect(fake.commits.size).toBe(commits)
      expect(await listSubmissions(env.DB)).toMatchObject([{ branch: BRANCH, pr: 1, count: 2 }])
    })

    it('is named by the submission when it is not the first free number', async () => {
      fake.branches.set(BRANCH, 'sha-main')
      await failedSubmit()
      const res = await submitNow()
      expect(res.status).toBe(200)
      expect(fake.pulls).toMatchObject([{ head: 'review/translation-bg-ivan-20261005-2' }])
      expect(reviewBranches()).toHaveLength(2)
      expect(await listSubmissions(env.DB)).toMatchObject([{ branch: 'review/translation-bg-ivan-20261005-2', pr: 1 }])
    })

    it('is left alone when the decisions changed since', async () => {
      await failedSubmit()
      const left = fake.branches.get(BRANCH)
      await decideFirst(2)
      expect((await submitNow()).status).toBe(200)
      expect(fake.pulls).toMatchObject([{ head: 'review/translation-bg-ivan-20261005-2' }])
      expect(fake.branches.get(BRANCH)).toBe(left)
    })

    it('is left alone when main moved since', async () => {
      await failedSubmit()
      const left = fake.branches.get(BRANCH)
      fake.pushToMain('review/unrelated.txt', 'x')
      expect((await submitNow()).status).toBe(200)
      expect(fake.pulls).toMatchObject([{ head: 'review/translation-bg-ivan-20261005-2' }])
      expect(fake.commits.get(fake.branches.get('review/translation-bg-ivan-20261005-2')!)!.parents).toEqual([fake.mainSha])
      expect(fake.branches.get(BRANCH)).toBe(left)
    })

    it('is left alone when a pull request was opened from it, even a closed one', async () => {
      await failedSubmit()
      fake.pulls.push({ number: 1, title: 't', head: BRANCH, body: '', state: 'closed', merged: false })
      const res = await submitNow()
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ pr: 2 })
      expect(fake.pulls.at(-1)).toMatchObject({ number: 2, head: 'review/translation-bg-ivan-20261005-2' })
    })
  })
})

describe('webhook and submissions', () => {
  const hook = async (payload: unknown, secret = 's3cret') => {
    const body = JSON.stringify(payload)
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('')
    return createApp(deps).request('/api/github/webhook', { method: 'POST', headers: { 'x-github-event': 'pull_request', 'x-hub-signature-256': `sha256=${sig}`, 'content-type': 'application/json' }, body })
  }

  it('a closed, unmerged pull request puts its decisions back to unsubmitted', async () => {
    await decideFirst(1)
    const out = (await (await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).json()) as SubmitResult
    expect((await hook({ action: 'closed', pull_request: { number: out.pr, merged: false } })).status).toBe(204)
    expect((await listDecisions(env.DB, id)).every((d) => d.submission === null)).toBe(true)
    expect((await listSubmissions(env.DB))[0]!.status).toBe('closed')
  })
  it('a merged one is marked merged', async () => {
    await decideFirst(1)
    const out = (await (await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).json()) as SubmitResult
    await hook({ action: 'closed', pull_request: { number: out.pr, merged: true } })
    expect((await listSubmissions(env.DB))[0]!.status).toBe('merged')
  })
  it('refuses a bad signature', async () => {
    expect((await hook({ action: 'closed', pull_request: { number: 1, merged: true } }, 'wrong')).status).toBe(401)
  })
  it('the admin list refreshes open submissions from GitHub', async () => {
    await decideFirst(1)
    await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })
    fake.pulls[0]!.state = 'closed'
    const list = (await (await as('admin@example.com', 'GET', '/api/admin/submissions')).json()) as SubmissionView[]
    expect(list[0]).toMatchObject({ status: 'closed', reviewerName: expect.any(String), queue: 'translation-bg', url: 'https://github.com/wordado/wordado-content/pull/1' })
  })
  it('the submissions list is admin-only', async () => {
    expect((await as('ivan@example.com', 'GET', '/api/admin/submissions')).status).toBe(403)
  })
})
