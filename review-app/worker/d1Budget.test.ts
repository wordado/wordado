import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Env } from './bindings'
import { countedDb, D1BudgetSpent, type CountedDb } from './d1Count'
import { insertReviewer, insertTopicsIfAbsent, putFeedbackAi, putSetting, replaceOpenIssues, type FeedbackAiRow } from './db'
import { AI_BATCH, AI_SWITCH } from './feedbackAi'
import { ISSUE_PAGES, refreshOpenIssues } from './openIssues'
import { FakeGitHub } from './test/fakeGitHub'
import { FakeLearnerApp, feedbackItem } from './test/fakeLearnerApp'
import { FakeModel } from './test/fakeModel'
import { testKeys } from './test/jwt'
import { fetchBy, resetDb, startPlatform, testDeps } from './test/platform'
import { runWeekly, WEEKLY_AI_CALLS, WEEKLY_PAGES } from './weekly'

/**
 * The Free plan allows a Worker 50 queries of D1 in one invocation. Every path of the feedback's AI help is held
 * here to BUDGET statements in its worst case, counting each member of a batch, so that a later change cannot
 * quietly go over the plan's limit. The count is of everything the invocation runs: for a route, the sign-in's
 * own read of the reviewer with it.
 */
const BUDGET = 40

const TOKEN = 't'.repeat(40)
const KEY = 'k'.repeat(40)
const SERVER = 'https://app.test'
const MODEL = 'https://model.test'
const GITHUB = 'https://api.github.com'
const RESEND = 'https://api.resend.com'
const ADMIN = 'admin@example.com'
/** A Monday, 06:00 UTC: the weekly job's hour. The week is 5 to 11 October. */
const NOW = '2026-10-12T06:00:00.000Z'
const WEEK_START = Date.parse('2026-10-05T00:00:00Z')

let base: Env
let env: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
let server: FakeLearnerApp
let model: FakeModel
let gh: FakeGitHub
let counted: CountedDb
let mails: number
let logged: string[]

/** The worst a call's answer can be for the database: every message in a topic of its own that is new, each naming an issue of its own. */
const worstAnswer = (name: string, input: unknown): unknown => {
  if (name === 'feedback_week') return { paragraph: 'Many messages came, each about something else.' }
  const { messages, issues } = input as { messages: { id: number }[]; issues: { number: number }[] }
  return { results: messages.map((m, i) => ({ id: m.id, language: 'de', translation: `Translated ${m.id}.`, category: 'bug', severity: 'blocks', summary: `Message ${m.id} in short.`, topic_id: 0, topic_new: `A subject of its own ${m.id}`, issue: issues[i]?.number ?? 0 })) }
}
const deps = () =>
  testDeps({ ...env, DB: counted.db }, {
    fetch: fetchBy({ [SERVER]: server.fetch, [MODEL]: model.fetch, [GITHUB]: gh.fetch, [RESEND]: async () => ((mails += 1), new Response('{}')) }),
    log: (line) => logged.push(line),
    now: () => new Date(NOW),
  })
const admin = async (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown) =>
  createApp(deps()).request(path, {
    method,
    headers: { 'cf-access-jwt-assertion': await keys.token(ADMIN, env, Math.floor(Date.parse(NOW) / 1000) + 3600), ...(body !== undefined ? { origin: env.APP_ORIGIN, 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
const aiRow = (over: Partial<FeedbackAiRow> = {}): FeedbackAiRow => ({ receivedAt: WEEK_START + 1, language: 'en', translation: '', category: 'bug', severity: 'annoys', summary: 'In short.', model: 'test/model', promptVersion: 2, createdAt: 't', ...over })
const rowsOf = async (table: string) => (await base.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n

beforeAll(async () => {
  keys = await testKeys()
  const p = await startPlatform()
  base = { ...p.env, ACCESS_JWKS: keys.jwks }
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(async () => {
  await resetDb(base.DB)
  env = { ...base, LEARNER_APP_URL: SERVER, FEEDBACK_READ_TOKEN: TOKEN, FEEDBACK_AI_KEY: KEY, FEEDBACK_AI_URL: `${MODEL}/api/v1`, RESEND_API_KEY: 're_test' }
  server = new FakeLearnerApp(TOKEN, [])
  model = new FakeModel(KEY)
  model.answer = worstAnswer
  gh = new FakeGitHub({})
  mails = 0
  logged = []
  await insertReviewer(base.DB, { email: ADMIN, name: 'Coordinator', languages: ['bg'], role: 'admin', invitedAt: 't', inviteSentAt: null, disabledAt: null })
  await putSetting(base.DB, AI_SWITCH, 'on', ADMIN, 't')
  // A hundred open issues, read a moment ago: every message of a call can name one of its own.
  await replaceOpenIssues(base.DB, Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `Issue ${i + 1}` })), NOW)
  counted = countedDb(base.DB)
})

describe('the statements one invocation runs against D1, in the worst case (Free plan: 50)', () => {
  it(`a page read by the AI: ${AI_BATCH} unread messages, each with a new topic and a proposed match`, async () => {
    server.items = Array.from({ length: 50 }, (_, i) => feedbackItem(i + 1, { receivedAt: WEEK_START + i * 60_000 }))
    const res = await admin('POST', '/api/admin/feedback/ai/read', { kind: '', before: null })
    expect(((await res.json()) as { asked: number; why: string | null })).toMatchObject({ asked: AI_BATCH, why: null })
    // It did all it can do: the readings, a topic for each, a match proposed on each.
    expect(await rowsOf('feedback_ai')).toBe(AI_BATCH)
    expect(await rowsOf('feedback_topics')).toBe(AI_BATCH)
    expect(await rowsOf("feedback_topics WHERE issue_state = 'proposed'")).toBe(AI_BATCH)
    console.log(`D1 statements, a page read by the AI: ${counted.statements()}`)
    expect(counted.statements()).toBeLessThanOrEqual(BUDGET)
  })

  it(`the weekly job: ${WEEKLY_PAGES} pages of messages, none of them read, and every call at its worst`, async () => {
    server.items = Array.from({ length: WEEKLY_PAGES * 100 + 50 }, (_, i) => feedbackItem(i + 1, { receivedAt: WEEK_START + i * 60_000 }))
    expect(await runWeekly(deps())).toBe('sent')
    expect(mails).toBe(1)
    expect(model.requests).toHaveLength(WEEKLY_AI_CALLS + 1)
    expect(await rowsOf('feedback_ai')).toBe(WEEKLY_AI_CALLS * AI_BATCH)
    expect(await rowsOf('feedback_topics')).toBe(WEEKLY_AI_CALLS * AI_BATCH)
    // The mail went with the AI's part, and the week was settled: the last statement was not the one over the limit.
    expect(await base.DB.prepare('SELECT messages, sent_at FROM weekly_mails').first()).toEqual({ messages: 1000, sent_at: NOW })
    expect(logged.join('\n')).not.toContain('without the AI')
    console.log(`D1 statements, the weekly job: ${counted.statements()}`)
    expect(counted.statements()).toBeLessThanOrEqual(BUDGET)
  })

  it('the daily read of the open issues: a hundred of them, and as many as it reads at most', async () => {
    for (const n of [100, ISSUE_PAGES * 100]) {
      await base.DB.prepare('DELETE FROM open_issues_reads').run()
      counted = countedDb(base.DB)
      gh.issues = Array.from({ length: n }, (_, i) => ({ number: i + 1, title: `Issue ${i + 1}, said anew` }))
      expect(await refreshOpenIssues(deps())).toBe('read')
      expect(await rowsOf("open_issues WHERE title LIKE '%said anew'")).toBe(n)
      console.log(`D1 statements, the daily read of ${n} open issues: ${counted.statements()}`)
      expect(counted.statements()).toBeLessThanOrEqual(BUDGET)
    }
  })

  it('a merge of two topics, each with messages, a note and a match', async () => {
    const made = await insertTopicsIfAbsent(base.DB, ['One', 'Two'], 't')
    const [one, two] = [made.get('One')!, made.get('Two')!]
    for (const [at, topicId] of [[0, one], [100, two]] as const) for (let i = 0; i < 60; i += 20) await putFeedbackAi(base.DB, new Map(Array.from({ length: 20 }, (_, k) => [at + i + k + 1, aiRow({ topicId })])))
    counted = countedDb(base.DB)
    expect((await admin('POST', `/api/admin/feedback/topics/${one}/merge`, { into: two })).status).toBe(200)
    expect(await rowsOf('feedback_topics')).toBe(1)
    console.log(`D1 statements, a merge: ${counted.statements()}`)
    expect(counted.statements()).toBeLessThanOrEqual(BUDGET)
  })

  it('Forget the AI’s results', async () => {
    await putFeedbackAi(base.DB, new Map(Array.from({ length: 20 }, (_, k) => [k + 1, aiRow()])))
    counted = countedDb(base.DB)
    expect((await admin('DELETE', '/api/admin/feedback/ai/results', {})).status).toBe(200)
    expect(await rowsOf('feedback_ai')).toBe(0)
    console.log(`D1 statements, Forget the AI’s results: ${counted.statements()}`)
    expect(counted.statements()).toBeLessThanOrEqual(BUDGET)
  })

  it('the draft of an issue, a topic opened, and the week with its paragraph', async () => {
    const topic = (await insertTopicsIfAbsent(base.DB, ['One'], NOW)).get('One')!
    server.items = Array.from({ length: 50 }, (_, i) => feedbackItem(i + 1, { receivedAt: WEEK_START + 6 * 24 * 60 * 60 * 1000 + i * 60_000, message: `about one thing ${i}` }))
    for (let i = 0; i < 50; i += 25) await putFeedbackAi(base.DB, new Map(server.items.slice(i, i + 25).map((item) => [item.id, aiRow({ topicId: topic, receivedAt: item.receivedAt })])))
    model.answer = (name) => (name === 'feedback_week' ? { paragraph: 'Fifty messages came about one thing.' } : { title: 'One thing', body: 'In our own words.' })
    const paths: [string, 'GET' | 'POST', string, unknown?][] = [
      ['a draft', 'POST', `/api/admin/feedback/topics/${topic}/draft`, {}],
      ['a topic opened', 'GET', `/api/admin/feedback/topics/${topic}`],
      ['the week', 'GET', '/api/admin/feedback/week'],
      ['the week’s paragraph', 'POST', '/api/admin/feedback/week/paragraph', {}],
      ['the list of messages', 'GET', '/api/admin/feedback?kind=&state=all'],
    ]
    for (const [what, method, path, body] of paths) {
      counted = countedDb(base.DB)
      expect((await admin(method, path, body)).status).toBe(200)
      console.log(`D1 statements, ${what}: ${counted.statements()}`)
      expect(counted.statements()).toBeLessThanOrEqual(BUDGET)
    }
  })
})

describe('countedDb', () => {
  it('counts one for a statement run by itself and one for each member of a batch, and none for a statement only prepared', async () => {
    const { db, statements } = countedDb(base.DB)
    const one = db.prepare('SELECT 1 AS n')
    expect(statements()).toBe(0)
    expect(await one.first()).toEqual({ n: 1 })
    expect((await db.prepare('SELECT ? AS n').bind(7).all()).results).toEqual([{ n: 7 }])
    await db.prepare('DELETE FROM feedback_marks').run()
    expect(statements()).toBe(3)
    await db.batch([db.prepare('SELECT 1'), db.prepare('SELECT ?').bind(2), db.prepare('SELECT 3')])
    expect(statements()).toBe(6)
  })

  it('with a limit, does not run the statement that would go over it, nor a batch that would', async () => {
    const { db, statements } = countedDb(base.DB, 3)
    await db.batch([db.prepare('SELECT 1'), db.prepare('SELECT 2')])
    await expect(db.batch([db.prepare("INSERT INTO feedback_topics (title, created_at, updated_at) VALUES ('Never', 't', 't')"), db.prepare('SELECT 2')])).rejects.toBeInstanceOf(D1BudgetSpent)
    await db.prepare('SELECT 1').first()
    await expect(db.prepare("INSERT INTO feedback_topics (title, created_at, updated_at) VALUES ('Never', 't', 't')").run()).rejects.toThrow('4 statements asked for, 3 allowed')
    expect(statements()).toBe(3)
    expect(await rowsOf("feedback_topics WHERE title = 'Never'")).toBe(0)
  })
})
