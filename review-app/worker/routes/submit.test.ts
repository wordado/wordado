import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { csvRecords } from '@wordado/pipeline/csv'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { RowsResponse, SubmissionView, SubmitResult } from '../../shared/hosted'
import { createApp, type Deps } from '../app'
import type { Env } from '../bindings'
import { insertAssignment, insertReviewer, insertSubmission, listDecisions, listSubmissions, markSubmitted, upsertDecision } from '../db'
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
/** Answers for the next look-ups of a branch's pull request, and for every listing of branches, in place of the fake's. */
let lookupAnswers: (() => Response)[] = []
let listingAnswer: (() => Response) | null = null

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
  lookupAnswers = []
  listingAnswer = null
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
        if (input.includes('/pulls?head=') && lookupAnswers.length > 0) return lookupAnswers.shift()!()
        if (input.includes('/git/matching-refs/') && listingAnswer) return listingAnswer()
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
    // The files are read together, not one request each: a submit over many files stays within what a Worker may ask.
    expect(fake.requests.filter((r) => r === 'POST /graphql')).toHaveLength(1)
    expect(fake.requests.some((r) => r.includes('/contents/'))).toBe(false)
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

describe('POST /api/submit for a spot check', () => {
  it('sends the decided rows of the sample and nothing else, and keeps the severity out of the files', async () => {
    const everything = await insertAssignment(env.DB, { reviewer: 'admin@example.com', queue: 'translation-bg', files: '*', flaggedOnly: false, createdAt: 't' })
    const passed = ((await (await as('admin@example.com', 'GET', `/api/rows?assignment=${everything}`)).json()) as RowsResponse).rows.filter((r) => r.ai === 'passed' && r.reports === '')
    const [kept, edited, dropped, undecided, stray] = passed
    const file = kept!.file
    const before = fake.files.get(file)!
    const sample = [kept!, edited!, dropped!, undecided!].map((r) => ({ file: r.file, key: r.key }))
    const spot = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: [file], flaggedOnly: false, spotCheck: { seed: 1, sample }, createdAt: 't' })
    const decide = (r: RowsResponse['rows'][number], body: Record<string, unknown>) =>
      as('ivan@example.com', 'POST', '/api/decision', { assignment: spot, queue: r.queue, file: r.file, key: r.key, rowHash: r.rowHash, ...body })
    expect((await decide(kept!, { action: 'keep' })).status).toBe(200)
    expect((await decide(edited!, { action: 'edit', cells: { translation: 'поправка' }, severity: 'minor' })).status).toBe(200)
    expect((await decide(dropped!, { action: 'drop', severity: 'major' })).status).toBe(200)
    // a decision on a row outside the sample, which the decision route would never store
    await upsertDecision(env.DB, { assignment: spot, queue: 'translation-bg', file, key: stray!.key, rowHash: stray!.rowHash, action: 'drop', cells: {}, note: '', severity: 'major', decidedAt: 't', submission: null })

    const res = await as('ivan@example.com', 'POST', '/api/submit', { assignment: spot })
    expect(res.status).toBe(200)
    expect((await res.json()) as SubmitResult).toMatchObject({ count: 3, leftOut: [] })
    const pr = fake.pulls[0]!
    expect(pr.title).toBe('translation-bg: 3 decisions by Ivan')
    expect(pr.body).toContain('Spot check of rows the AI review passed: 1 serious, 1 minor.')
    const commit = fake.commits.get(fake.branches.get(pr.head)!)!
    expect([...commit.files.keys()].filter((path) => commit.files.get(path) !== fake.files.get(path))).toEqual([file])
    const after = csvRecords(commit.files.get(file)!)
    const was = new Map(csvRecords(before).rows.map((r) => [r['key'], r]))
    const changed = after.rows.filter((r) => JSON.stringify(r) !== JSON.stringify(was.get(r['key']))).map((r) => r['key'])
    expect(changed.sort()).toEqual([kept!.key, edited!.key, dropped!.key].sort())
    const verdict = (key: string) => after.rows.find((r) => r['key'] === key)!['verdict']
    expect([verdict(kept!.key), verdict(edited!.key), verdict(dropped!.key), verdict(undecided!.key), verdict(stray!.key)]).toEqual(['ok', 'ok', 'drop', '', ''])
    expect(after.rows.find((r) => r['key'] === edited!.key)!['translation']).toBe('поправка')
    expect(after.header).toEqual(csvRecords(before).header)
    expect(commit.files.get(file)).not.toMatch(/major|minor|serious/)
    const decisions = await listDecisions(env.DB, spot)
    expect(decisions.filter((d) => d.submission !== null).map((d) => d.key).sort()).toEqual([kept!.key, edited!.key, dropped!.key].sort())
    expect(decisions.find((d) => d.key === stray!.key)!.submission).toBeNull()
  })

  it('says nothing about a spot check in the pull request of another assignment', async () => {
    await decideFirst(1)
    await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })
    expect(fake.pulls[0]!.body).not.toMatch(/Spot check/)
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

  it('does not blame GitHub for a failure of its own: a neutral sentence, the cause in the log, the claim released', async () => {
    await decideFirst(1)
    for (let n = 1; n <= 20; n += 1) fake.branches.set(`review/translation-bg-ivan-20261005-${n}`, 'sha-main')
    const res = await submitNow()
    expect(res.status).toBe(502)
    expect(await messageOf(res)).toBe('The submit failed. Your decisions are saved; try again.')
    expect(logs.some((l) => l.includes('could not find a free branch name'))).toBe(true)
    expect(await listSubmissions(env.DB)).toHaveLength(0)
  })

  describe('when GitHub cannot say whether the pull request was opened', () => {
    const down = () => new Response('{"message":"Server Error"}', { status: 500 })
    const unreachable = (): Response => { throw new TypeError('connect ECONNRESET 10.0.0.1') }

    async function unconfirmed(answers: typeof pullAnswers, lookups: typeof lookupAnswers, message: string): Promise<void> {
      await decideFirst(2)
      pullAnswers = answers
      lookupAnswers = lookups
      const res = await submitNow()
      expect(res.status).toBe(502)
      expect(await messageOf(res)).toBe(message)
      // The claim stays, with its decisions.
      expect(await listSubmissions(env.DB)).toMatchObject([{ branch: BRANCH, pr: null, status: 'open' }])
      expect((await listDecisions(env.DB, id)).every((d) => d.submission !== null)).toBe(true)
      expect(logs.some((l) => l.includes('the claim is kept'))).toBe(true)
      // The next Submit finds the pull request for the claim: no second branch, no second pull request.
      const next = await submitNow()
      expect(next.status).toBe(200)
      expect(await next.json()).toMatchObject({ pr: 1, count: 2 })
      expect(fake.pulls).toHaveLength(1)
      expect(reviewBranches()).toEqual([BRANCH])
      expect(await listSubmissions(env.DB)).toMatchObject([{ branch: BRANCH, pr: 1 }])
    }

    it('keeps the claim after a 502 that opened it, and the next Submit completes with that pull request', async () => {
      await unconfirmed([{ ...refused(502, { message: 'Server Error' }), after: true }, refused(502, { message: 'Server Error' })], [down, down], 'GitHub did not confirm the pull request (502: Server Error). Your decisions are saved; try Submit again in a couple of minutes.')
    })
    it('keeps the claim after a network error that opened it', async () => {
      await unconfirmed([{ res: unreachable, after: true }, { res: unreachable }], [unreachable, unreachable], 'GitHub did not confirm the pull request (GitHub was not reached). Your decisions are saved; try Submit again in a couple of minutes.')
    })
    it('keeps the claim after a 422 when the look-up fails: in progress at first, released later, and its branch used again', async () => {
      await decideFirst(1)
      pullAnswers = [refused(422, { message: 'Validation Failed' })]
      lookupAnswers = [down]
      expect((await submitNow()).status).toBe(502)
      expect(await listSubmissions(env.DB)).toMatchObject([{ branch: BRANCH, pr: null }])
      expect((await submitNow()).status).toBe(409)
      await env.DB.prepare('UPDATE submissions SET created_at = ?').bind('2026-10-05T11:50:00Z').run()
      expect((await submitNow()).status).toBe(200)
      expect(fake.pulls).toMatchObject([{ number: 1, head: BRANCH }])
      expect(reviewBranches()).toEqual([BRANCH])
    })
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

    it('is left alone when another claim names it', async () => {
      await failedSubmit()
      const other = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'level', files: '*', flaggedOnly: false, createdAt: 't' })
      await insertSubmission(env.DB, { assignment: other, branch: BRANCH, pr: null, url: null, count: 1, leftOut: 0, status: 'open', createdAt: '2026-10-05T11:59:30Z' })
      expect((await submitNow()).status).toBe(200)
      expect(fake.pulls).toMatchObject([{ head: 'review/translation-bg-ivan-20261005-2' }])
    })

    it.each([500, 403])('is not looked for when GitHub answers %i for the branches: the submit writes a new branch', async (status) => {
      await failedSubmit()
      listingAnswer = () => new Response('{"message":"no"}', { status })
      const res = await submitNow()
      expect(res.status).toBe(200)
      expect(fake.pulls).toMatchObject([{ number: 1, head: 'review/translation-bg-ivan-20261005-2' }])
      expect(logs.some((l) => l.includes('no look for a branch left behind'))).toBe(true)
    })

    it('is used though its message ends with a newline', async () => {
      await failedSubmit()
      const commit = fake.commits.get(fake.branches.get(BRANCH)!)!
      commit.message = `${commit.message}\n`
      expect((await submitNow()).status).toBe(200)
      expect(reviewBranches()).toEqual([BRANCH])
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
