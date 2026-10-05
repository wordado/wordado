import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { csvRecords } from '@wordado/pipeline/csv'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { RowsResponse, SubmissionView, SubmitResult } from '../../shared/hosted'
import { createApp, type Deps } from '../app'
import type { Env } from '../bindings'
import { insertAssignment, insertReviewer, listDecisions, listSubmissions } from '../db'
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
  deps = testDeps(env, {
    fetch: async (input, init) => {
      if (input.startsWith('https://api.github.test/')) {
        if (failGitHub) return new Response('{"message":"down"}', { status: 500 })
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
