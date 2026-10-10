import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Env } from './bindings'
import { openIssues } from './db'
import { appRepo, ISSUE_PAGES, refreshOpenIssues } from './openIssues'
import { FakeGitHub } from './test/fakeGitHub'
import { resetDb, startPlatform, testDeps } from './test/platform'

const API = 'https://api.github.com'
const NOON = new Date('2026-10-05T12:00:00Z')

let base: Env
let env: Env
let dispose: () => Promise<void>
let gh: FakeGitHub
let logged: string[]
let now: Date
/** What `fetch` was called with, beside what the fake records. */
let calls: { url: string; init: RequestInit }[]

beforeAll(async () => {
  const p = await startPlatform()
  base = p.env
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(async () => {
  await resetDb(base.DB)
  env = { ...base, APP_REPO: 'wordado/wordado' }
  gh = new FakeGitHub({})
  gh.issues = [{ number: 94, title: 'The sound of a word plays twice on a phone' }, { number: 12, title: 'A dark theme' }]
  logged = []
  calls = []
  now = NOON
})

const deps = () => testDeps(env, { fetch: (url, init = {}) => (calls.push({ url, init }), gh.fetch(url, init)), log: (line) => logged.push(line), now: () => now })
const kept = () => openIssues(env.DB, '2000-01-01T00:00:00.000Z', 1000)
const reads = async () => (await env.DB.prepare('SELECT day, outcome FROM open_issues_reads ORDER BY day').all()).results
const nextDay = () => (now = new Date(now.getTime() + 24 * 60 * 60 * 1000))

describe('appRepo', () => {
  it('is the setting when it is an owner and a name, and null otherwise', () => {
    const of = (APP_REPO?: string) => appRepo(APP_REPO === undefined ? {} : { APP_REPO })
    expect(of('wordado/wordado')).toBe('wordado/wordado')
    expect(of(' an-owner/a.repo_1 ')).toBe('an-owner/a.repo_1')
    for (const bad of [undefined, '', 'wordado', 'a/b/c', 'a/', '/b', 'a b/c', 'a/b?x=1', 'https://github.com/a/b', '../b', 'a/..']) expect(of(bad)).toBeNull()
  })
})

describe('the read of the open issues (spec 2026-10-10 §3.3)', () => {
  it('asks GitHub’s public API for the open issues of the app’s repository, with no token, and keeps numbers and titles', async () => {
    expect(await refreshOpenIssues(deps())).toBe('read')
    expect(calls.map((c) => c.url)).toEqual([`${API}/repos/wordado/wordado/issues?state=open&per_page=100&page=1`])
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('accept')).toBe('application/vnd.github+json')
    expect(headers.get('user-agent')).toBe('wordado-review')
    expect(calls[0]!.init.method ?? 'GET').toBe('GET')
    expect(calls[0]!.init.redirect).toBe('manual')
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal)
    expect(gh.issueRequests).toEqual([{ authorization: null, page: 1 }])
    expect(await kept()).toEqual([{ number: 94, title: 'The sound of a word plays twice on a phone' }, { number: 12, title: 'A dark theme' }])
    expect(await reads()).toEqual([{ day: '2026-10-05', outcome: 'read' }])
    expect(logged).toEqual(['open issues: 2 read'])
  })

  it('asks the address GITHUB_API_URL names when it is set, as the tests and the browser run do', async () => {
    env = { ...env, GITHUB_API_URL: 'http://127.0.0.1:4182' }
    expect(await refreshOpenIssues(deps())).toBe('read')
    expect(calls[0]!.url).toBe('http://127.0.0.1:4182/repos/wordado/wordado/issues?state=open&per_page=100&page=1')
  })

  it('skips pull requests, and anything that is not a number and a title; a title is one line of at most 200 characters', async () => {
    gh.issues = [
      { number: 94, title: 'Sound plays twice' },
      { number: 95, title: 'A pull request', pull_request: {} },
      { number: 0, title: 'No number' },
      { number: 1.5, title: 'Half a number' },
      { number: 96, title: '   ' },
      { number: 97, title: 7 as unknown as string },
      { number: 98, title: `Two\nlines\tand a tab ${'x'.repeat(300)}` },
    ]
    expect(await refreshOpenIssues(deps())).toBe('read')
    const issues = await kept()
    expect(issues.map((i) => i.number)).toEqual([98, 94])
    expect(issues[0]!.title).toBe(`Two lines and a tab ${'x'.repeat(180)}`)
    expect(issues[0]!.title).toHaveLength(200)
  })

  it(`reads page after page while a page is full, and at most ${ISSUE_PAGES}`, async () => {
    gh.issues = Array.from({ length: 150 }, (_, i) => ({ number: i + 1, title: `Issue ${i + 1}` }))
    expect(await refreshOpenIssues(deps())).toBe('read')
    expect(gh.issueRequests.map((r) => r.page)).toEqual([1, 2])
    expect(await kept()).toHaveLength(150)
    nextDay()
    gh.issueRequests.length = 0
    gh.issues = Array.from({ length: 100 * ISSUE_PAGES + 50 }, (_, i) => ({ number: i + 1, title: `Issue ${i + 1}` }))
    expect(await refreshOpenIssues(deps())).toBe('read')
    expect(gh.issueRequests.map((r) => r.page)).toEqual([1, 2, 3])
    expect(await kept()).toHaveLength(100 * ISSUE_PAGES)
  })

  it('puts what it read in place of what was kept: an issue that was closed is gone', async () => {
    await refreshOpenIssues(deps())
    nextDay()
    gh.issues = [{ number: 94, title: 'The sound of a word plays twice' }, { number: 101, title: 'New since yesterday' }]
    expect(await refreshOpenIssues(deps())).toBe('read')
    expect(await kept()).toEqual([{ number: 101, title: 'New since yesterday' }, { number: 94, title: 'The sound of a word plays twice' }])
    // Fresh as of the second read.
    expect(await openIssues(env.DB, now.toISOString(), 100)).toHaveLength(2)
  })

  it('reads once a UTC day at most: a second run the same day asks nobody', async () => {
    expect(await refreshOpenIssues(deps())).toBe('read')
    now = new Date('2026-10-05T23:00:00Z')
    expect(await refreshOpenIssues(deps())).toBe('already')
    expect(calls).toHaveLength(1)
    expect(logged.at(-1)).toBe('open issues: already read today')
    nextDay()
    expect(await refreshOpenIssues(deps())).toBe('read')
    expect(calls).toHaveLength(2)
  })

  it('keeps what it has when GitHub refuses, logs the status alone, and does not try again that day', async () => {
    await refreshOpenIssues(deps())
    nextDay()
    gh.issuesFailure = { status: 403, body: '{"message":"API rate limit exceeded for 203.0.113.7."}' }
    expect(await refreshOpenIssues(deps())).toBe('failed')
    expect(calls).toHaveLength(2)
    expect(await kept()).toHaveLength(2)
    expect(logged.at(-1)).toBe('open issues: not read, GitHub answered 403')
    expect(logged.join('\n')).not.toContain('203.0.113.7')
    // The same day: nobody is asked again, whatever the first read came to.
    gh.issuesFailure = null
    expect(await refreshOpenIssues(deps())).toBe('already')
    expect(calls).toHaveLength(2)
    expect(await reads()).toEqual([{ day: '2026-10-05', outcome: 'read' }, { day: '2026-10-06', outcome: 'failed' }])
  })

  it('keeps what it has when a later page fails, when GitHub is not reached, redirects, or answers something else', async () => {
    await refreshOpenIssues(deps())
    const before = await kept()
    const failures: [() => void, string][] = [
      [() => ((gh.issues = Array.from({ length: 150 }, (_, i) => ({ number: i + 500, title: 'x' }))), (gh.issuesFailure = { status: 500, body: 'oops', fromPage: 2 })), 'open issues: not read, GitHub answered 500'],
      [() => (gh.issuesFailure = new TypeError('fetch failed')), 'open issues: not read, TypeError'],
      [() => (gh.issuesFailure = { status: 301, body: '' }), 'open issues: not read, GitHub answered 301'],
      [() => (gh.issuesFailure = { status: 200, body: '{"message":"not a list"}' }), 'open issues: not read, the answer was not a list of issues'],
      [() => (gh.issuesFailure = { status: 200, body: 'not json' }), 'open issues: not read, the answer was not a list of issues'],
    ]
    for (const [fail, line] of failures) {
      nextDay()
      fail()
      expect(await refreshOpenIssues(deps())).toBe('failed')
      expect(logged.at(-1)).toBe(line)
      expect(await kept()).toEqual(before)
    }
  })

  it('does nothing without a repository to read, and takes no day for it', async () => {
    for (const APP_REPO of ['', 'not a repository']) {
      env = { ...env, APP_REPO }
      expect(await refreshOpenIssues(deps())).toBe('no-repo')
    }
    expect(calls).toEqual([])
    expect(await reads()).toEqual([])
    expect(logged).toEqual(Array(2).fill('open issues: not read, APP_REPO is not set to owner/name'))
  })

  it('never throws: a database that fails is a read that failed', async () => {
    const broken = { ...env, DB: { prepare: () => { throw new TypeError('no database') }, batch: () => { throw new TypeError('no database') } } as unknown as Env['DB'] }
    await expect(refreshOpenIssues(testDeps(broken, { fetch: gh.fetch, log: (line) => logged.push(line) }))).resolves.toBe('failed')
    expect(logged).toEqual(['open issues: not read, TypeError'])
  })
})
