import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MAX_FEEDBACK_NOTE_LENGTH, type FeedbackList, type FeedbackView } from '../../shared/hosted'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { insertReviewer } from '../db'
import { FakeLearnerApp, feedbackItem } from '../test/fakeLearnerApp'
import { testKeys } from '../test/jwt'
import { resetDb, startPlatform, testDeps } from '../test/platform'
import { FEEDBACK_PAGE } from './feedback'

const TOKEN = 't'.repeat(40)
const SERVER = 'https://app.test'

let base: Env
let env: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
let server: FakeLearnerApp
let logged: string[]

beforeAll(async () => {
  keys = await testKeys()
  const p = await startPlatform()
  base = { ...p.env, ACCESS_JWKS: keys.jwks }
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(async () => {
  await resetDb(base.DB)
  env = { ...base, LEARNER_APP_URL: SERVER, FEEDBACK_READ_TOKEN: TOKEN }
  server = new FakeLearnerApp(TOKEN, [
    feedbackItem(1, { message: 'The path does not open.', contactEmail: 'ana@example.com', signedIn: true }),
    feedbackItem(2, { kind: 'idea', message: 'A dark theme.\nAnd bigger letters.' }),
    feedbackItem(3, { kind: 'other', message: 'Thank you.' }),
  ])
  logged = []
  await insertReviewer(env.DB, { email: 'ivan@example.com', name: 'Ivan', languages: ['bg'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
})

const as = async (email: string, method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}) =>
  createApp(testDeps(env, { fetch: server.fetch, log: (line) => logged.push(line) })).request(path, {
    method,
    headers: {
      'cf-access-jwt-assertion': await keys.token(email, env),
      ...(body !== undefined ? { origin: env.APP_ORIGIN, 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

// The admin reviewer is created on their first request (GET /api/me), as app.ts does for ADMIN_EMAIL.
const admin = async (method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown, headers?: Record<string, string>) => {
  await as('admin@example.com', 'GET', '/api/me')
  return as('admin@example.com', method, path, body, headers)
}

/** The page the admin gets, which must be a connected one. */
async function list(query = ''): Promise<{ items: readonly FeedbackView[]; read: number; nextBefore: number | null }> {
  const res = await admin('GET', `/api/admin/feedback${query}`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as FeedbackList
  if (!body.connected) throw new Error('the feedback is not connected')
  return body
}
const ids = (page: { items: readonly FeedbackView[] }) => page.items.map((item) => item.id)
const marks = () => env.DB.prepare('SELECT * FROM feedback_marks ORDER BY feedback_id').all()

describe('GET /api/admin/feedback (spec §16)', () => {
  it('is for admins only', async () => {
    expect((await as('ivan@example.com', 'GET', '/api/admin/feedback')).status).toBe(403)
    expect((await as('ivan@example.com', 'PUT', '/api/admin/feedback/1', { state: 'done', note: '' })).status).toBe(403)
    expect((await as('nobody@example.com', 'GET', '/api/admin/feedback')).status).toBe(403)
    expect(server.requests).toEqual([])
    expect((await marks()).results).toEqual([])
  })

  it('gives what the learner app’s server holds, newest first, each message new until it is marked', async () => {
    const page = await list()
    expect(page.nextBefore).toBeNull()
    expect(page.items).toEqual([
      { ...feedbackItem(3, { kind: 'other', message: 'Thank you.' }), state: 'new', note: '', markedAt: null },
      { ...feedbackItem(2, { kind: 'idea', message: 'A dark theme.\nAnd bigger letters.' }), state: 'new', note: '', markedAt: null },
      { ...feedbackItem(1, { message: 'The path does not open.', contactEmail: 'ana@example.com', signedIn: true }), state: 'new', note: '', markedAt: null },
    ])
  })

  it('asks the server once for a page, with the token in a header and never in the address', async () => {
    let init: RequestInit | undefined
    const fetch = server.fetch
    const seen = async (input: string, i?: RequestInit) => ((init = i), fetch(input, i))
    await as('admin@example.com', 'GET', '/api/me')
    const res = await createApp(testDeps(env, { fetch: seen })).request('/api/admin/feedback?kind=idea&before=3', { headers: { 'cf-access-jwt-assertion': await keys.token('admin@example.com', env) } })
    expect(res.status).toBe(200)
    expect(server.requests).toEqual([`GET /v1/admin/feedback?limit=${FEEDBACK_PAGE}&kind=idea&before=3`])
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(init?.redirect).toBe('manual')
    expect(init?.method ?? 'GET').toBe('GET')
    expect(await res.text()).not.toContain(TOKEN)
  })

  it('takes a server address with a slash at its end', async () => {
    env = { ...env, LEARNER_APP_URL: `${SERVER}/` }
    expect(ids(await list())).toEqual([3, 2, 1])
    expect(server.requests).toEqual([`GET /v1/admin/feedback?limit=${FEEDBACK_PAGE}`])
  })

  it('joins the coordinator’s marks, and keeps nothing of the messages', async () => {
    expect((await admin('PUT', '/api/admin/feedback/2', { state: 'seen', note: 'Asked the designer.' })).status).toBe(200)
    const page = await list()
    expect(page.items.map((item) => [item.id, item.state, item.note, item.markedAt])).toEqual([
      [3, 'new', '', null],
      [2, 'seen', 'Asked the designer.', '2026-10-05T12:00:00.000Z'],
      [1, 'new', '', null],
    ])
    expect((await marks()).results).toEqual([{ feedback_id: 2, state: 'seen', note: 'Asked the designer.', updated_at: '2026-10-05T12:00:00.000Z', updated_by: 'admin@example.com' }])
    // Nothing a learner sent is in the review app's database, in any table.
    const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'").all<{ name: string }>()).results
    expect(tables.map((t) => t.name)).toContain('feedback_marks')
    for (const { name } of tables) {
      const rows = JSON.stringify((await env.DB.prepare(`SELECT * FROM ${name}`).all()).results)
      for (const theirs of ['A dark theme', 'The path does not open', 'ana@example.com', 'Mozilla', 'B3kq9xZa']) expect(rows).not.toContain(theirs)
    }
  })

  it('no longer shows a message, or its address, once the server no longer gives it', async () => {
    await admin('PUT', '/api/admin/feedback/1', { state: 'seen', note: 'Answered.' })
    server.items = [feedbackItem(1, { message: 'The path does not open.', contactEmail: '' }), feedbackItem(3)]
    const page = await list()
    expect(ids(page)).toEqual([3, 1])
    expect(page.items[1]).toMatchObject({ contactEmail: '', state: 'seen', note: 'Answered.' })
  })

  it('filters by state after reading the page: open is everything not done and not declined', async () => {
    await admin('PUT', '/api/admin/feedback/1', { state: 'done', note: '' })
    await admin('PUT', '/api/admin/feedback/2', { state: 'declined', note: 'Not now.' })
    server.items.push(feedbackItem(4), feedbackItem(5))
    await admin('PUT', '/api/admin/feedback/4', { state: 'seen', note: '' })
    expect(ids(await list())).toEqual([5, 4, 3, 2, 1])
    expect(ids(await list('?state=all'))).toEqual([5, 4, 3, 2, 1])
    expect(ids(await list('?state=open'))).toEqual([5, 4, 3])
    expect(ids(await list('?state=done'))).toEqual([1])
    expect(ids(await list('?state=declined'))).toEqual([2])
    expect(ids(await list('?state=open&kind=bug'))).toEqual([5, 4])
    expect(ids(await list('?state=&kind='))).toEqual([5, 4, 3, 2, 1])
  })

  it('pages with the server’s cursor, so a page the filter leaves short or empty still leads to the older messages', async () => {
    server.items = Array.from({ length: FEEDBACK_PAGE + 2 }, (_, i) => feedbackItem(i + 1))
    await admin('PUT', '/api/admin/feedback/1', { state: 'done', note: '' })
    await admin('PUT', `/api/admin/feedback/${FEEDBACK_PAGE + 2}`, { state: 'done', note: '' })
    const first = await list('?state=open')
    expect(first.items).toHaveLength(FEEDBACK_PAGE - 1)
    expect(first.read).toBe(FEEDBACK_PAGE)
    expect(first.nextBefore).toBe(3)
    const second = await list(`?state=open&before=${first.nextBefore}`)
    expect(ids(second)).toEqual([2])
    expect(second.nextBefore).toBeNull()
    // Nothing done among the newest: the page is empty, and the cursor is still there.
    const done = await list('?state=declined')
    expect(done.items).toEqual([])
    expect(done.read).toBe(FEEDBACK_PAGE)
    expect(done.nextBefore).toBe(3)
    server.requests.length = 0
    await list('?state=done')
    expect(server.requests).toHaveLength(1)
  })

  it('refuses a filter or a cursor it does not know, without asking the server', async () => {
    for (const query of ['?kind=praise', '?state=closed', '?before=abc', '?before=0', '?before=1.5']) {
      const res = await admin('GET', `/api/admin/feedback${query}`)
      expect(res.status).toBe(400)
    }
    expect(server.requests).toEqual([])
  })

  it('says it is not connected while the token or the server’s address is not set, and asks nobody', async () => {
    for (const missing of [{ FEEDBACK_READ_TOKEN: '' }, { LEARNER_APP_URL: '' }, { FEEDBACK_READ_TOKEN: ' ', LEARNER_APP_URL: ' ' }]) {
      env = { ...env, ...missing }
      const res = await admin('GET', '/api/admin/feedback?state=open')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ connected: false })
    }
    const { LEARNER_APP_URL: _url, FEEDBACK_READ_TOKEN: _token, ...unset } = env
    env = unset
    expect(await (await admin('GET', '/api/admin/feedback')).json()).toEqual({ connected: false })
    expect(server.requests).toEqual([])
    // The marks can still be made: they are the review app's own.
    expect((await admin('PUT', '/api/admin/feedback/1', { state: 'done', note: '' })).status).toBe(200)
  })

  it('answers 502 with a short message when the server is not reached, and logs nothing of the request', async () => {
    server.failure = new TypeError(`connect failed with authorization Bearer ${TOKEN}`)
    const res = await admin('GET', '/api/admin/feedback')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ message: 'The app’s server could not be reached.' })
    expect(logged.join('\n')).toContain('was not reached')
    expect(logged.join('\n')).not.toContain(TOKEN)
  })

  it('answers 502 naming the status when the server answers an error, and passes on nothing of its body', async () => {
    server.failure = { status: 500, body: `{"error":"internal","leak":"select * from feedback ${TOKEN}"}` }
    const res = await admin('GET', '/api/admin/feedback')
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ message: 'The app’s server answered 500.' })
    expect(text).not.toContain('leak')
    expect(logged.join('\n')).not.toContain(TOKEN)
    // A redirect is an error too: the token is not sent on.
    server.failure = { status: 302, body: '' }
    expect(await (await admin('GET', '/api/admin/feedback')).json()).toEqual({ message: 'The app’s server answered 302.' })
  })

  it('answers 502 with a hint when the server does not know the token', async () => {
    env = { ...env, FEEDBACK_READ_TOKEN: 'x'.repeat(40) }
    const res = await admin('GET', '/api/admin/feedback')
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ message: 'The app’s server answered 404. Check that FEEDBACK_READ_TOKEN is the same in both deployments.' })
    expect(text).not.toContain('x'.repeat(40))
    expect(text).not.toContain(TOKEN)
  })

  it('answers 502 when the answer is not a page of feedback', async () => {
    for (const body of ['<html>', '{}', '{"items":[{"id":1}],"nextBefore":null}', JSON.stringify({ items: [feedbackItem(1)], nextBefore: 'soon' }), JSON.stringify({ items: [{ ...feedbackItem(1), kind: 'praise' }] })]) {
      server.failure = { status: 200, body }
      const res = await admin('GET', '/api/admin/feedback')
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ message: 'The app’s server gave an answer the review app does not understand.' })
    }
  })

  it('passes on only the fields it knows', async () => {
    server.failure = { status: 200, body: JSON.stringify({ items: [{ ...feedbackItem(1), userId: 'user-1' }], nextBefore: null }) }
    const res = await admin('GET', '/api/admin/feedback')
    expect(res.status).toBe(200)
    expect(await res.text()).not.toContain('user-1')
  })
})

describe('PUT /api/admin/feedback/:id (spec §16)', () => {
  const put = (id: string, body: unknown, headers?: Record<string, string>) => admin('PUT', `/api/admin/feedback/${id}`, body, headers)

  it('sets the state and the note, who set them and when, and sets them again', async () => {
    const first = await put('7', { state: 'seen', note: '  Looks like the service worker.  ' })
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ id: 7, state: 'seen', note: 'Looks like the service worker.', markedAt: '2026-10-05T12:00:00.000Z' })
    expect((await put('7', { state: 'done', note: '' })).status).toBe(200)
    expect((await marks()).results).toEqual([{ feedback_id: 7, state: 'done', note: '', updated_at: '2026-10-05T12:00:00.000Z', updated_by: 'admin@example.com' }])
    // Back to new is a mark like any other.
    expect((await put('7', { state: 'new', note: 'x'.repeat(MAX_FEEDBACK_NOTE_LENGTH) })).status).toBe(200)
    expect(server.requests).toEqual([])
  })

  it('refuses anything that is not exactly a state and a note', async () => {
    for (const body of [
      { state: 'closed', note: '' },
      { state: 'done' },
      { note: 'only a note' },
      { state: 'done', note: 7 },
      { state: 'done', note: null },
      { state: 'done', note: 'x'.repeat(MAX_FEEDBACK_NOTE_LENGTH + 1) },
      { state: 'done', note: '', message: 'a copy of the message' },
      { state: ['done'], note: '' },
      [],
    ]) {
      expect((await put('7', body)).status).toBe(400)
    }
    for (const id of ['0', '-1', '1.5', 'abc', '7x', '99999999999999999999']) expect((await put(id, { state: 'done', note: '' })).status).toBe(400)
    expect((await marks()).results).toEqual([])
  })

  it('is refused from another origin, and without a JSON body', async () => {
    expect((await put('7', { state: 'done', note: '' }, { origin: 'https://elsewhere.example.com' })).status).toBe(403)
    expect((await put('7', { state: 'done', note: '' }, { 'content-type': 'text/plain' })).status).toBe(415)
    expect((await marks()).results).toEqual([])
  })
})
