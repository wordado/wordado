import type { FeedbackItem } from '@wordado/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MAX_FEEDBACK_NOTE_LENGTH, MAX_TOPIC_TITLE_LENGTH, type FeedbackTopicOpened, type FeedbackTopicView } from '../../shared/hosted'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { insertReviewer, insertTopicsIfAbsent, proposeTopicIssues, putFeedbackAi, replaceOpenIssues, type FeedbackAiRow } from '../db'
import { FakeLearnerApp, feedbackItem } from '../test/fakeLearnerApp'
import { FakeModel } from '../test/fakeModel'
import { testKeys } from '../test/jwt'
import { fetchBy, resetDb, startPlatform, testDeps } from '../test/platform'
import { TOPIC_PAGE } from './feedbackTopics'

const TOKEN = 't'.repeat(40)
const KEY = 'k'.repeat(40)
const SERVER = 'https://app.test'
const MODEL = 'https://model.test'
const GITHUB = 'https://api.github.com'
const ADMIN = 'admin@example.com'
const NOW = '2026-10-05T12:00:00.000Z'

let base: Env
let env: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
let server: FakeLearnerApp
let model: FakeModel
let logged: string[]
/** Every request that left the Worker, whoever it was for. */
let outbound: string[]
let sound: number
let words: number
let empty: number

const items = (): FeedbackItem[] => [
  feedbackItem(1, { message: 'The sound plays twice.', contactEmail: 'ana.contact@example.com' }),
  feedbackItem(2, { kind: 'idea', message: 'Let me choose how many new words a day.' }),
  feedbackItem(3, { kind: 'other', language: 'de', message: 'Der Ton wird zweimal abgespielt.' }),
  feedbackItem(4, { kind: 'other', message: 'Благодаря за приложението!' }),
  feedbackItem(5, { message: 'I hear every word two times.' }),
]
const aiRow = (over: Partial<FeedbackAiRow> = {}): FeedbackAiRow => ({ receivedAt: 1, language: 'en', translation: '', category: 'bug', severity: 'annoys', summary: 'In short.', model: 'test/model', promptVersion: 2, createdAt: 't', ...over })

beforeAll(async () => {
  keys = await testKeys()
  const p = await startPlatform()
  base = { ...p.env, ACCESS_JWKS: keys.jwks }
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(async () => {
  await resetDb(base.DB)
  // The AI help is set up and switched on: the routes here still never ask the model.
  env = { ...base, LEARNER_APP_URL: SERVER, FEEDBACK_READ_TOKEN: TOKEN, FEEDBACK_AI_KEY: KEY, FEEDBACK_AI_URL: `${MODEL}/api/v1` }
  server = new FakeLearnerApp(TOKEN, items())
  model = new FakeModel(KEY)
  logged = []
  outbound = []
  await insertReviewer(env.DB, { email: 'ivan@example.com', name: 'Ivan', languages: ['bg'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
  await as(ADMIN, 'GET', '/api/me')
  await as(ADMIN, 'PUT', '/api/admin/feedback/ai', { on: true })
  const made = await insertTopicsIfAbsent(env.DB, ['Sound plays twice on phones', 'Number of new words a day', 'Nothing in it'], 't')
  ;[sound, words, empty] = ['Sound plays twice on phones', 'Number of new words a day', 'Nothing in it'].map((title) => made.get(title)!) as [number, number, number]
  await putFeedbackAi(env.DB, new Map([
    [1, aiRow({ topicId: sound, receivedAt: feedbackItem(1).receivedAt })],
    [3, aiRow({ topicId: sound, receivedAt: feedbackItem(3).receivedAt, language: 'de', translation: 'The sound is played twice.', severity: 'blocks' })],
    [5, aiRow({ topicId: sound, receivedAt: feedbackItem(5).receivedAt })],
    [2, aiRow({ topicId: words, receivedAt: feedbackItem(2).receivedAt, category: 'idea', severity: null })],
    [4, aiRow({ receivedAt: feedbackItem(4).receivedAt, category: 'praise', severity: null })],
  ]))
  outbound = []
})

type Method = 'GET' | 'PUT' | 'POST' | 'DELETE'
const recorded = (fake: (input: string, init?: RequestInit) => Promise<Response>) => (input: string, init?: RequestInit) => (outbound.push(input), fake(input, init))
const as = async (email: string, method: Method, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  createApp(testDeps(env, { fetch: fetchBy({ [SERVER]: recorded(server.fetch), [MODEL]: recorded(model.fetch), [GITHUB]: recorded(async () => new Response('[]')) }), log: (line) => logged.push(line), now: () => new Date(NOW) })).request(path, {
    method,
    headers: {
      'cf-access-jwt-assertion': await keys.token(email, env),
      ...(body !== undefined ? { origin: env.APP_ORIGIN, 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
const admin = (method: Method, path: string, body?: unknown, headers?: Record<string, string>) => as(ADMIN, method, path, body, headers)
const topics = async () => (await (await admin('GET', '/api/admin/feedback/topics')).json()) as FeedbackTopicView[]
const topic = async (id: number) => (await topics()).find((t) => t.id === id)
async function open(id: number): Promise<FeedbackTopicOpened> {
  const res = await admin('GET', `/api/admin/feedback/topics/${id}`)
  expect(res.status).toBe(200)
  return (await res.json()) as FeedbackTopicOpened
}
const marks = async () => (await env.DB.prepare('SELECT feedback_id, state, note, updated_by FROM feedback_marks ORDER BY feedback_id').all()).results
const topicsOf = async () => Object.fromEntries((await env.DB.prepare('SELECT feedback_id, topic_id, topic_by FROM feedback_ai ORDER BY feedback_id').all<{ feedback_id: number; topic_id: number | null; topic_by: string }>()).results.map((r) => [r.feedback_id, [r.topic_id, r.topic_by]]))
const raw = async (id: number) => env.DB.prepare('SELECT * FROM feedback_topics WHERE id = ?').bind(id).first<Record<string, unknown>>()
const messageOf = async (res: Response) => ((await res.json()) as { message: string }).message

/** Every route of the topics that changes something, with a body it takes. */
const changes = (): [Method, string, unknown][] => [
  ['PUT', '/api/admin/feedback/4/topic', { topic: sound }],
  ['PUT', `/api/admin/feedback/topics/${sound}/issue`, { issue: 94 }],
  ['PUT', `/api/admin/feedback/topics/${sound}`, { title: 'Renamed', state: 'done', note: 'x' }],
  ['POST', `/api/admin/feedback/topics/${sound}/merge`, { into: words }],
]

describe('the topics’ routes (spec 2026-10-10 §3.2, §3.3)', () => {
  it('are for admins only, and a change comes from the app’s own origin', async () => {
    expect((await as('ivan@example.com', 'GET', '/api/admin/feedback/topics')).status).toBe(403)
    expect((await as('ivan@example.com', 'GET', `/api/admin/feedback/topics/${sound}`)).status).toBe(403)
    for (const [method, path, body] of changes()) {
      expect((await as('ivan@example.com', method, path, body)).status).toBe(403)
      expect((await admin(method, path, body, { origin: 'https://elsewhere.example.com' })).status).toBe(403)
    }
    expect(await raw(sound)).toMatchObject({ title: 'Sound plays twice on phones', state: 'new', issue: null })
    expect(await topicsOf()).toMatchObject({ 4: [null, 'ai'], 1: [sound, 'ai'] })
    expect(await marks()).toEqual([])
    expect(outbound).toEqual([])
  })

  it('never ask the model, and write to nobody: only opening a topic asks the learner app’s server, to read', async () => {
    await topics()
    await open(sound)
    for (const [method, path, body] of changes()) expect((await admin(method, path, body)).status).toBe(200)
    expect(model.requests).toEqual([])
    expect(outbound).toHaveLength(1)
    expect(server.requests).toEqual([`GET /v1/admin/feedback?limit=${TOPIC_PAGE}&ids=5%2C3%2C1`])
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback_ai_calls').first<{ n: number }>())?.n).toBe(0)
  })
})

describe('GET /api/admin/feedback/topics', () => {
  it('lists one line a topic from the database alone: count, newest message, worst severity, state and match', async () => {
    await replaceOpenIssues(env.DB, [{ number: 94, title: 'The sound of a word plays twice on a phone' }], NOW)
    await proposeTopicIssues(env.DB, [{ topic: sound, issue: 94 }])
    const res = await admin('GET', '/api/admin/feedback/topics')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual([
      { id: sound, title: 'Sound plays twice on phones', state: 'new', note: '', issue: 94, issueState: 'proposed', issueTitle: 'The sound of a word plays twice on a phone', count: 3, newestAt: feedbackItem(5).receivedAt, worst: 'blocks' },
      { id: words, title: 'Number of new words a day', state: 'new', note: '', issue: null, issueState: 'none', issueTitle: null, count: 1, newestAt: feedbackItem(2).receivedAt, worst: null },
    ])
    expect(outbound).toEqual([])
  })

  it('works while feedback is not connected and the AI help is off', async () => {
    env = { ...env, LEARNER_APP_URL: '', FEEDBACK_AI_KEY: '' }
    expect((await topics()).map((t) => t.id)).toEqual([sound, words])
  })
})

describe('GET /api/admin/feedback/topics/:id', () => {
  it('gives the topic and its messages, newest first, with their marks and readings, in one request by id', async () => {
    await admin('PUT', '/api/admin/feedback/3', { state: 'seen', note: 'Asked the developer.' })
    const res = await admin('GET', `/api/admin/feedback/topics/${sound}`)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const opened = (await res.json()) as FeedbackTopicOpened
    expect(opened.topic).toMatchObject({ id: sound, title: 'Sound plays twice on phones', count: 3, worst: 'blocks' })
    expect(opened.more).toBe(0)
    expect(opened.incomplete).toBe(false)
    expect(opened.items.map((item) => [item.id, item.message, item.state, item.note, item.ai?.translation, item.ai?.topic?.id])).toEqual([
      [5, 'I hear every word two times.', 'new', '', '', sound],
      [3, 'Der Ton wird zweimal abgespielt.', 'seen', 'Asked the developer.', 'The sound is played twice.', sound],
      [1, 'The sound plays twice.', 'new', '', '', sound],
    ])
    // The address for an answer is shown to the coordinator, as in the list of messages.
    expect(opened.items[2]!.contactEmail).toBe('ana.contact@example.com')
    expect(server.requests).toEqual([`GET /v1/admin/feedback?limit=${TOPIC_PAGE}&ids=5%2C3%2C1`])
    expect(outbound).toHaveLength(1)
  })

  it(`reads the ${TOPIC_PAGE} newest messages of a topic, and says how many older ones there are`, async () => {
    const many = Array.from({ length: TOPIC_PAGE + 7 }, (_, i) => i + 100)
    server.items = many.map((id) => feedbackItem(id))
    for (let from = 0; from < many.length; from += 25) await putFeedbackAi(env.DB, new Map(many.slice(from, from + 25).map((id) => [id, aiRow({ topicId: words })])))
    const opened = await open(words)
    expect(opened.items).toHaveLength(TOPIC_PAGE)
    expect(opened.items[0]!.id).toBe(many.at(-1))
    expect(opened.more).toBe(8)
    expect(opened.topic.count).toBe(TOPIC_PAGE + 8)
    expect(outbound).toHaveLength(1)
  })

  it('drops the readings of messages the server no longer has, and counts without them', async () => {
    server.items = server.items.filter((item) => item.id !== 3)
    const opened = await open(sound)
    expect(opened.items.map((item) => item.id)).toEqual([5, 1])
    expect(opened).toMatchObject({ incomplete: false, more: 0, topic: { count: 2, worst: 'annoys' } })
    expect(Object.keys(await topicsOf())).toEqual(['1', '2', '4', '5'])
  })

  it('opens incomplete with a server from before `ids`, and drops nothing', async () => {
    server.knowsIds = false
    // That server gives its newest page, whatever was asked: here it holds a message of another topic too.
    const opened = await open(sound)
    expect(opened.incomplete).toBe(true)
    expect(opened.items.map((item) => item.id)).toEqual([5, 3, 1])
    expect(Object.keys(await topicsOf())).toHaveLength(5)
    // With more messages than a page, some of the topic's are not in what it gives: they are missing, not gone.
    server.items = [...server.items, ...Array.from({ length: 60 }, (_, i) => feedbackItem(i + 100))]
    const short = await open(sound)
    expect(short).toMatchObject({ incomplete: true, items: [], more: 0, topic: { count: 3 } })
    expect(Object.keys(await topicsOf())).toHaveLength(5)
    expect(outbound).toHaveLength(2)
  })

  it('opens a topic with no message without asking anybody', async () => {
    expect(await open(empty)).toMatchObject({ topic: { id: empty, count: 0 }, items: [], more: 0, incomplete: false })
    expect(outbound).toEqual([])
  })

  it('answers 404 for no such topic, 400 for what is not an id, 409 while feedback is not connected, 502 when the server fails', async () => {
    expect((await admin('GET', '/api/admin/feedback/topics/9999')).status).toBe(404)
    expect((await admin('GET', '/api/admin/feedback/topics/abc')).status).toBe(400)
    expect(outbound).toEqual([])
    server.failure = { status: 500, body: 'a body that must not be passed on' }
    const failed = await admin('GET', `/api/admin/feedback/topics/${sound}`)
    expect(failed.status).toBe(502)
    expect(await messageOf(failed)).toBe('The app’s server answered 500.')
    expect(Object.keys(await topicsOf())).toHaveLength(5)
    env = { ...env, FEEDBACK_READ_TOKEN: '' }
    expect((await admin('GET', `/api/admin/feedback/topics/${sound}`)).status).toBe(409)
  })
})

describe('PUT /api/admin/feedback/topics/:id', () => {
  const put = (id: number, body: unknown) => admin('PUT', `/api/admin/feedback/topics/${id}`, body)

  it('renames a topic, and sets its state and its note, with who and when', async () => {
    const res = await put(sound, { title: '  The sound of a word is played twice ', state: 'seen', note: ' Asked the developer. ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ topic: expect.objectContaining({ id: sound, title: 'The sound of a word is played twice', state: 'seen', note: 'Asked the developer.', count: 3 }), marked: 0 })
    expect(await raw(sound)).toMatchObject({ renamed: 1, updated_at: NOW, updated_by: ADMIN })
    // The same title again is no rename.
    await put(words, { title: 'Number of new words a day', state: 'seen', note: '' })
    expect(await raw(words)).toMatchObject({ renamed: 0, state: 'seen' })
    expect(await marks()).toEqual([])
  })

  it('answers 409 for a title another topic has, saying to merge instead', async () => {
    const res = await put(sound, { title: 'number of NEW words a day', state: 'new', note: '' })
    expect(res.status).toBe(409)
    expect(await messageOf(res)).toBe('Another topic has this title. Merge the two instead.')
    expect(await raw(sound)).toMatchObject({ title: 'Sound plays twice on phones', renamed: 0 })
  })

  it('marks the topic’s messages done when the topic is marked done, keeping their notes; Not doing marks none', async () => {
    await admin('PUT', '/api/admin/feedback/3', { state: 'seen', note: 'Asked the developer.' })
    await admin('PUT', '/api/admin/feedback/2', { state: 'seen', note: 'Another topic.' })
    const declined = await put(words, { title: 'Number of new words a day', state: 'declined', note: '' })
    expect(await declined.json()).toMatchObject({ topic: { state: 'declined' }, marked: 0 })
    expect(await marks()).toEqual([
      { feedback_id: 2, state: 'seen', note: 'Another topic.', updated_by: ADMIN },
      { feedback_id: 3, state: 'seen', note: 'Asked the developer.', updated_by: ADMIN },
    ])
    const done = await put(sound, { title: 'Sound plays twice on phones', state: 'done', note: 'Fixed.' })
    expect(await done.json()).toMatchObject({ topic: { state: 'done', note: 'Fixed.' }, marked: 3 })
    expect(await marks()).toEqual([
      { feedback_id: 1, state: 'done', note: '', updated_by: ADMIN },
      { feedback_id: 2, state: 'seen', note: 'Another topic.', updated_by: ADMIN },
      { feedback_id: 3, state: 'done', note: 'Asked the developer.', updated_by: ADMIN },
      { feedback_id: 5, state: 'done', note: '', updated_by: ADMIN },
    ])
    // A topic that is done already marks nothing again: a message the coordinator opened again stays open.
    await admin('PUT', '/api/admin/feedback/5', { state: 'seen', note: 'Came back.' })
    expect(await (await put(sound, { title: 'Sound plays twice on phones', state: 'done', note: 'Fixed in the next version.' })).json()).toMatchObject({ marked: 0 })
    expect((await marks())[3]).toMatchObject({ feedback_id: 5, state: 'seen' })
    expect(outbound).toEqual([])
  })

  it('refuses anything that is not exactly a title, a state and a note', async () => {
    const good = { title: 'A good title', state: 'seen', note: '' }
    const bad: unknown[] = [
      {},
      { title: 'A good title', state: 'seen' },
      { ...good, extra: 1 },
      { ...good, issue: 94 },
      { ...good, renamed: 0 },
      { ...good, state: 'closed' },
      { ...good, note: 7 },
      { ...good, note: 'x'.repeat(MAX_FEEDBACK_NOTE_LENGTH + 1) },
      { ...good, title: 7 },
      { ...good, title: 'ab' },
      { ...good, title: '   ' },
      { ...good, title: 'x'.repeat(MAX_TOPIC_TITLE_LENGTH + 1) },
      { ...good, title: 'Two lines\nof title' },
      { ...good, title: 'Write to ana@example.com' },
      { ...good, title: 'See https://example.com/x' },
    ]
    for (const body of bad) expect((await put(sound, body)).status).toBe(400)
    expect(await raw(sound)).toMatchObject({ title: 'Sound plays twice on phones', state: 'new', updated_by: null })
    expect((await put(9999, good)).status).toBe(404)
    expect((await put(0, good)).status).toBe(400)
    expect((await put(sound, { ...good, title: 'x'.repeat(MAX_TOPIC_TITLE_LENGTH) })).status).toBe(200)
  })
})

describe('POST /api/admin/feedback/topics/:id/merge', () => {
  const merge = (id: number, body: unknown) => admin('POST', `/api/admin/feedback/topics/${id}/merge`, body)

  it('merges the topic into the other one: its messages go over, and it is gone', async () => {
    const res = await merge(words, { into: sound })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: sound, title: 'Sound plays twice on phones', count: 4 })
    expect((await topics()).map((t) => t.id)).toEqual([sound])
    expect(await topicsOf()).toMatchObject({ 2: [sound, 'ai'] })
    expect(await raw(sound)).toMatchObject({ updated_by: ADMIN })
    expect(await marks()).toEqual([])
    expect(outbound).toEqual([])
  })

  it('refuses a merge into itself, into or from no such topic, and a body that is not exactly `into`', async () => {
    expect((await merge(sound, { into: sound })).status).toBe(400)
    expect((await merge(sound, { into: 9999 })).status).toBe(404)
    expect((await merge(9999, { into: sound })).status).toBe(404)
    for (const body of [{}, { into: '2' }, { into: 1.5 }, { into: 0 }, { into: null }, { into: words, title: 'x' }, { into: [words] }]) expect((await merge(sound, body)).status).toBe(400)
    expect((await topics()).map((t) => [t.id, t.count])).toEqual([[sound, 3], [words, 1]])
  })
})

describe('PUT /api/admin/feedback/:id/topic', () => {
  const move = (id: number | string, body: unknown) => admin('PUT', `/api/admin/feedback/${id}/topic`, body)

  it('moves a message to a topic, as the coordinator’s choice', async () => {
    const res = await move(1, { topic: words })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 1, topic: { id: words, title: 'Number of new words a day' } })
    expect(await topicsOf()).toMatchObject({ 1: [words, 'coordinator'], 3: [sound, 'ai'] })
    // A message in no topic can be given one.
    expect((await move(4, { topic: sound })).status).toBe(200)
    expect(await topicsOf()).toMatchObject({ 4: [sound, 'coordinator'] })
    expect(await marks()).toEqual([])
    expect(outbound).toEqual([])
  })

  it('answers 404 for a message with no reading or no such topic, and refuses a body that is not exactly `topic`', async () => {
    expect((await move(77, { topic: sound })).status).toBe(404)
    expect((await move(1, { topic: 9999 })).status).toBe(404)
    expect((await move('abc', { topic: sound })).status).toBe(400)
    for (const body of [{}, { topic: '1' }, { topic: null }, { topic: 0 }, { topic: sound, by: 'ai' }, { topic: { id: sound } }]) expect((await move(1, body)).status).toBe(400)
    expect(await topicsOf()).toMatchObject({ 1: [sound, 'ai'] })
  })

  it('leaves the mark of a message as it is: a message called "topic" is not a mark', async () => {
    expect((await admin('PUT', '/api/admin/feedback/1', { state: 'seen', note: 'Mine.' })).status).toBe(200)
    await move(1, { topic: words })
    expect(await marks()).toEqual([{ feedback_id: 1, state: 'seen', note: 'Mine.', updated_by: ADMIN }])
  })
})

describe('PUT /api/admin/feedback/topics/:id/issue', () => {
  const match = (id: number, body: unknown) => admin('PUT', `/api/admin/feedback/topics/${id}/issue`, body)

  it('confirms a proposed match, takes a number the coordinator typed, and removes one', async () => {
    await replaceOpenIssues(env.DB, [{ number: 94, title: 'The sound of a word plays twice on a phone' }], NOW)
    await proposeTopicIssues(env.DB, [{ topic: sound, issue: 94 }])
    const confirmed = await match(sound, { issue: 94 })
    expect(confirmed.status).toBe(200)
    expect(await confirmed.json()).toMatchObject({ id: sound, issue: 94, issueState: 'confirmed', issueTitle: 'The sound of a word plays twice on a phone' })
    expect(await raw(sound)).toMatchObject({ updated_by: ADMIN, updated_at: NOW })
    // A number of an issue the review app has never read is taken as typed.
    expect(await (await match(words, { issue: 7 })).json()).toMatchObject({ id: words, issue: 7, issueState: 'confirmed', issueTitle: null })
    expect(await (await match(sound, { issue: null })).json()).toMatchObject({ id: sound, issue: null, issueState: 'removed' })
    // Removed: the AI proposes nothing for this topic again.
    await proposeTopicIssues(env.DB, [{ topic: sound, issue: 94 }])
    expect(await topic(sound)).toMatchObject({ issue: null, issueState: 'removed' })
    expect(outbound).toEqual([])
  })

  it('answers 404 for no such topic, and refuses a body that is not exactly an issue’s number or null', async () => {
    expect((await match(9999, { issue: 94 })).status).toBe(404)
    for (const body of [{}, { issue: '94' }, { issue: 0 }, { issue: -1 }, { issue: 1.5 }, { issue: 1e12 }, { issue: 94, state: 'confirmed' }, { number: 94 }]) expect((await match(sound, body)).status).toBe(400)
    expect(await topic(sound)).toMatchObject({ issue: null, issueState: 'none' })
  })
})
