import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AssignmentView } from '../shared/hosted'
import { createApp } from './app'
import type { Env } from './bindings'
import { countedDb, D1BudgetSpent, type CountedDb } from './d1Count'
import { closeAssignment, insertAssignment, insertReviewer, insertTopicsIfAbsent, putFeedbackAi, putSetting, replaceOpenIssues, type FeedbackAiRow } from './db'
import { AI_BATCH, AI_SWITCH } from './feedbackAi'
import { resetGitHubTokens } from './github'
import { ISSUE_PAGES, refreshOpenIssues } from './openIssues'
import { resetSnapshotCache } from './snapshotStore'
import { FakeGitHub, testAppKey } from './test/fakeGitHub'
import { FakeLearnerApp, feedbackItem } from './test/fakeLearnerApp'
import { FakeModel } from './test/fakeModel'
import { testKeys } from './test/jwt'
import { noticeFile } from './test/notices'
import { fetchBy, resetDb, startPlatform, testDeps } from './test/platform'
import { putSnapshot } from './test/snapshot'
import { runWeekly, WEEKLY_AI_CALLS, WEEKLY_PAGES } from './weekly'

/**
 * The Free plan allows a Worker 50 queries of D1 in one invocation. Every path of the feedback's AI help is held
 * here to BUDGET statements in its worst case, counting each member of a batch, so that a later change cannot
 * quietly go over the plan's limit. The count is of everything the invocation runs: for a route, the sign-in's
 * own read of the reviewer with it.
 */
const BUDGET = 40

const TOKEN = 't'.repeat(40)
const WRITE_TOKEN = 'w'.repeat(40)
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
  resetGitHubTokens()
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

  it('the Accounts tab: the sweep’s counts, the counts of accounts, a lookup and a delete, which keep nothing here (#187, #206)', async () => {
    env = { ...env, ADMIN_WRITE_TOKEN: WRITE_TOKEN }
    server.writeToken = WRITE_TOKEN
    server.accounts.set('ana@example.com', { createdAt: WEEK_START, lastSignInAt: WEEK_START })
    const paths: [string, 'GET' | 'POST', string, unknown?][] = [
      ['the sweep’s counts', 'GET', '/api/admin/accounts/sweep'],
      ['the counts of accounts', 'GET', '/api/admin/accounts/stats'],
      ['a lookup', 'POST', '/api/admin/accounts/lookup', { email: 'ana@example.com' }],
      ['a delete', 'POST', '/api/admin/accounts/delete', { email: 'ana@example.com', confirm: true }],
    ]
    for (const [what, method, path, body] of paths) {
      counted = countedDb(base.DB)
      expect((await admin(method, path, body)).status).toBe(200)
      console.log(`D1 statements, ${what}: ${counted.statements()}`)
      // The sign-in's own read of the reviewer, and nothing more.
      expect(counted.statements()).toBeLessThanOrEqual(1)
    }
    expect(server.accounts.size).toBe(0)
  })

  it('the Announcements tab: the list, a draft, its preview, the test send, the send, a stop and a resume, which keep nothing here (#185)', async () => {
    env = { ...env, ADMIN_WRITE_TOKEN: WRITE_TOKEN }
    server.writeToken = WRITE_TOKEN
    const texts = { en: { subject: 'The terms change', body: 'Hello.' } }
    const paths: [string, 'GET' | 'POST', string, unknown?][] = [
      ['a draft', 'POST', '/api/admin/announcements/save', { kind: 'service', texts }],
      ['the list', 'GET', '/api/admin/announcements'],
      ['a preview', 'POST', '/api/admin/announcements/preview', { id: 1 }],
      ['the test send', 'POST', '/api/admin/announcements/test', { id: 1, version: 1, email: 'owner@example.com' }],
      ['the send', 'POST', '/api/admin/announcements/send', { id: 1, version: 1, kind: 'service', recipients: 3, confirm: 'service 3' }],
      ['a stop', 'POST', '/api/admin/announcements/stop', { id: 1 }],
      ['a resume', 'POST', '/api/admin/announcements/resume', { id: 1 }],
      ['another draft', 'POST', '/api/admin/announcements/save', { kind: 'news', texts }],
      ['its deletion', 'POST', '/api/admin/announcements/delete', { id: 2 }],
    ]
    for (const [what, method, path, body] of paths) {
      counted = countedDb(base.DB)
      expect((await admin(method, path, body)).status).toBe(200)
      console.log(`D1 statements, ${what}: ${counted.statements()}`)
      // The sign-in's own read of the reviewer, and nothing more.
      expect(counted.statements()).toBeLessThanOrEqual(1)
    }
    expect(server.announcements.map((a) => a.status)).toEqual(['sending'])
  })

  it('the Mail tab’s form: the prepared notice, and a translation into every other language (#215)', async () => {
    env = { ...env, ADMIN_WRITE_TOKEN: WRITE_TOKEN, NOTICES_REPO: 'an-owner/a-repo', NOTICES_PATH: 'notices', GITHUB_APP_PRIVATE_KEY: (await testAppKey()).pem }
    server.writeToken = WRITE_TOKEN
    gh = new FakeGitHub({ 'notices/2026-10-11-new-terms.md': noticeFile('New terms of use', { en: { subject: 'The terms change', body: 'Hello.' } }) }, 'an-owner/a-repo')
    model.answer = (_name, input) => ({ subject: `${(input as { language: string }).language}: the terms change`, body: 'Hello.' })
    counted = countedDb(base.DB)
    const offered = await admin('GET', '/api/admin/announcements/prepared')
    expect(((await offered.json()) as { notice: { file: string } | null }).notice?.file).toBe('2026-10-11-new-terms.md')
    console.log(`D1 statements, the prepared notice: ${counted.statements()}`)
    // The sign-in's own read of the reviewer, and nothing more.
    expect(counted.statements()).toBeLessThanOrEqual(1)
    counted = countedDb(base.DB)
    const translated = await admin('POST', '/api/admin/announcements/translate', { subject: 'The terms change', body: 'Hello.', languages: ['bg', 'de', 'es'] })
    expect(Object.keys(((await translated.json()) as { texts: object }).texts)).toEqual(['bg', 'de', 'es'])
    console.log(`D1 statements, a translation into three languages: ${counted.statements()}`)
    // The reviewer, the switch, and one count for each language.
    expect(counted.statements()).toBeLessThanOrEqual(5)
  })
})

describe('the lists of assignments (#281)', () => {
  it('Admin → Assignments with fifty closed assignments that keep no figures yet, and My work', async () => {
    await putSnapshot(base)
    resetSnapshotCache()
    await insertReviewer(base.DB, { email: 'ivan@example.com', name: 'Ivan', languages: ['bg', 'en'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
    for (let i = 0; i < 60; i += 1) await closeAssignment(base.DB, await insertAssignment(base.DB, { reviewer: 'ivan@example.com', queue: i % 2 ? 'level' : 'translation-bg', files: '*', flaggedOnly: false, createdAt: 't' }), 't')
    for (const queue of ['translation-bg', 'level']) await insertAssignment(base.DB, { reviewer: 'ivan@example.com', queue, files: '*', flaggedOnly: true, createdAt: 't' })
    const lists: [string, string, string][] = [
      ['Admin → Assignments, keeping the closed ones’ figures', ADMIN, '/api/admin/assignments'],
      ['Admin → Assignments once they are kept', ADMIN, '/api/admin/assignments'],
      ['My work', 'ivan@example.com', '/api/assignments'],
    ]
    for (const [what, email, path] of lists) {
      counted = countedDb(base.DB)
      const res = await createApp(deps()).request(path, { headers: { 'cf-access-jwt-assertion': await keys.token(email, env, Math.floor(Date.parse(NOW) / 1000) + 3600) } })
      expect(((await res.json()) as AssignmentView[]).every((a) => a.progress !== null)).toBe(true)
      console.log(`D1 statements, ${what}: ${counted.statements()}`)
      expect(counted.statements()).toBeLessThanOrEqual(BUDGET)
    }
    expect(await rowsOf('assignments WHERE frozen_progress IS NOT NULL')).toBe(50)
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
