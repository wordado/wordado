import { MAX_ANNOUNCEMENT_SUBJECT } from '@wordado/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Announcement, AnnouncementPreview, AnnouncementTranslation, AnnouncementsView } from '../../shared/hosted'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { aiCallsToday, insertReviewer, putSetting } from '../db'
import { AI_SWITCH } from '../feedbackAi'
import { resetGitHubTokens } from '../github'
import { FakeGitHub, testAppKey } from '../test/fakeGitHub'
import { FakeLearnerApp } from '../test/fakeLearnerApp'
import { FakeModel } from '../test/fakeModel'
import { testKeys } from '../test/jwt'
import { noticeFile } from '../test/notices'
import { resetDb, startPlatform, testDeps } from '../test/platform'

const READ_TOKEN = 't'.repeat(40)
const WRITE_TOKEN = 'w'.repeat(40)
const SERVER = 'https://app.test'
const GITHUB = 'https://api.github.com'
const MODEL = 'https://model.test'
const KEY = 'k'.repeat(40)
const NOTICES = 'an-owner/a-repo'
const OWNER = 'owner@example.com'
const en = { subject: 'The terms change on 1 December', body: 'Hello,\n\nthe terms change.' }

let base: Env
let env: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
let server: FakeLearnerApp
let gh: FakeGitHub
let model: FakeModel
let appKey: string
let logged: string[]
let calls: { url: string; init: RequestInit }[]

beforeAll(async () => {
  keys = await testKeys()
  const p = await startPlatform()
  base = { ...p.env, ACCESS_JWKS: keys.jwks }
  dispose = p.dispose
  appKey = (await testAppKey()).pem
})
afterAll(() => dispose())
beforeEach(async () => {
  await resetDb(base.DB)
  env = { ...base, LEARNER_APP_URL: `${SERVER}/`, FEEDBACK_READ_TOKEN: READ_TOKEN, ADMIN_WRITE_TOKEN: WRITE_TOKEN }
  server = new FakeLearnerApp(READ_TOKEN)
  server.writeToken = WRITE_TOKEN
  gh = new FakeGitHub({}, NOTICES)
  model = new FakeModel(KEY)
  resetGitHubTokens()
  logged = []
  calls = []
  await insertReviewer(env.DB, { email: 'ivan@example.com', name: 'Ivan', languages: ['bg'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
})

const as = async (email: string, method: 'GET' | 'POST', path: string, body?: unknown) =>
  createApp(
    testDeps(env, {
      // Each request goes to the fake of its origin: GitHub, the model's service, and for anything else the learner app's server.
      fetch: (url, init = {}) => (calls.push({ url, init }), (url.startsWith(`${GITHUB}/`) ? gh : url.startsWith(`${MODEL}/`) ? model : server).fetch(url, init)),
      log: (line) => logged.push(line),
    }),
  ).request(path, {
    method,
    headers: { 'cf-access-jwt-assertion': await keys.token(email, env), ...(body !== undefined ? { origin: env.APP_ORIGIN, 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

// The admin reviewer is created on their first request (GET /api/me), as app.ts does for ADMIN_EMAIL.
const admin = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
  await as('admin@example.com', 'GET', '/api/me')
  return as('admin@example.com', method, path, body)
}
const answer = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> })
const post = async (path: string, body: unknown) => answer(await admin('POST', `/api/admin/announcements/${path}`, body))

/** A draft on the server, as the tab would have written it. */
async function draft(kind: 'service' | 'news' = 'service'): Promise<Announcement> {
  const { status, body } = await post('save', { kind, texts: { en } })
  expect(status).toBe(200)
  return body['announcement'] as unknown as Announcement
}

const PATHS = ['save', 'delete', 'preview', 'test', 'send', 'stop', 'resume']

describe('the Announcements tab’s routes (#185)', () => {
  it('are for admins only', async () => {
    expect((await as('ivan@example.com', 'GET', '/api/admin/announcements')).status).toBe(403)
    for (const path of PATHS) expect((await as('ivan@example.com', 'POST', `/api/admin/announcements/${path}`, { id: 1 })).status).toBe(403)
    expect(server.requests).toEqual([])
  })

  it('lists the announcements with the limits a send works under, field by field', async () => {
    const a = await draft()
    const res = await admin('GET', '/api/admin/announcements')
    const view = (await res.json()) as AnnouncementsView
    expect(view).toEqual({ connected: true, announcements: [a], limits: { perDay: 50, sentToday: 0, batch: 20 } })
    // What the server sends beyond the fields the tab shows is not passed on.
    expect(Object.keys((view as { announcements: readonly object[] }).announcements[0]!)).not.toContain('updatedAt')
    expect(calls.at(-1)!.url).toBe(`${SERVER}/v1/admin/announcements`)
    expect(new Headers(calls.at(-1)!.init.headers).get('authorization')).toBe(`Bearer ${WRITE_TOKEN}`)
    expect(calls.at(-1)!.init.redirect).toBe('manual')
  })

  it('does not pass on an answer that is not a list of announcements', async () => {
    await draft()
    server.announcements = [{ ...server.announcements[0]!, sent: -1 }]
    expect(await answer(await admin('GET', '/api/admin/announcements'))).toEqual({ status: 502, body: { message: 'The app’s server gave an answer the review app does not understand.' } })
    server.announcements = [{ ...server.announcements[0]!, sent: 0, kind: 'marketing' as 'news' }]
    expect((await admin('GET', '/api/admin/announcements')).status).toBe(502)
  })

  it('writes a draft and changes it, checking the texts before the server is asked', async () => {
    const a = await draft('news')
    expect(a).toMatchObject({ id: 1, kind: 'news', status: 'draft', version: 1, testedVersion: null, texts: { en } })
    const changed = await post('save', { id: a.id, kind: 'service', texts: { en: { subject: ' Other ', body: 'Text' }, de: { subject: '', body: '' } }, anything: 'else' })
    expect(changed.body['announcement']).toMatchObject({ id: 1, kind: 'service', version: 2, texts: { en: { subject: 'Other', body: 'Text' } } })
    // Only the named fields go on, and the texts as they were checked.
    expect(server.bodies.at(-1)).toEqual({ id: a.id, kind: 'service', texts: { en: { subject: 'Other', body: 'Text' } } })
    const asked = server.requests.length
    for (const body of [{ kind: 'marketing', texts: { en } }, { kind: 'news', texts: { bg: en } }, { kind: 'news', texts: { en: { subject: 's'.repeat(MAX_ANNOUNCEMENT_SUBJECT + 1), body: 'b' } } }, { id: 'one', kind: 'news', texts: { en } }]) {
      expect((await post('save', body)).status).toBe(400)
    }
    expect((await post('save', { kind: 'news', texts: { en: { subject: 'One\nBcc: x@example.com', body: 'b' } } })).body).toEqual({ message: 'en: the subject must be one line of plain text' })
    expect(server.requests).toHaveLength(asked)
  })

  it('previews an announcement as it is mailed, with how many accounts get it', async () => {
    const a = await draft('news')
    const { status, body } = await post('preview', { id: a.id })
    expect(status).toBe(200)
    const preview = body as unknown as AnnouncementPreview
    expect(preview).toMatchObject({ version: 1, kind: 'news', recipients: 1, byLanguage: { en: 1 } })
    expect(preview.mails).toEqual([{ language: 'en', subject: en.subject, text: expect.stringContaining('To stop it, open:') }])
  })

  it('sends a test to one address, which goes in the body and into no log', async () => {
    const a = await draft()
    for (const email of ['owner', '', 7, 'a@b c', 'two@example.com,three@example.com']) expect((await post('test', { id: a.id, version: 1, email })).status).toBe(400)
    expect(server.testSends).toEqual([])
    const { status, body } = await post('test', { id: a.id, version: 1, email: ` ${OWNER} ` })
    expect(status).toBe(200)
    expect(body).toMatchObject({ mails: 1, announcement: { testedVersion: 1 } })
    expect(server.testSends).toEqual([{ id: a.id, version: 1, email: OWNER }])
    expect(calls.at(-1)!.url).toBe(`${SERVER}/v1/admin/announcements/test`)
    expect(logged.join('\n')).not.toContain('owner')
    expect(logged).toContain('announcements: 1 test mail sent')
    server.mailRefused = true
    expect(await post('test', { id: a.id, version: 1, email: OWNER })).toEqual({ status: 502, body: { message: 'The test was not sent: the mail service did not take it (busy). Nothing was marked as tested.' } })
  })

  it('starts a send only with the confirmation typed for this kind and this many accounts', async () => {
    const a = await draft()
    await post('test', { id: a.id, version: 1, email: OWNER })
    const asked = server.requests.length
    for (const confirm of [undefined, '', 'service', 'news 3', 'service 2', 'SERVICE 3', true]) {
      const refused = await post('send', { id: a.id, version: 1, kind: 'service', recipients: 3, confirm })
      expect(refused).toEqual({ status: 400, body: { message: 'To send, type the kind and the number of accounts as shown: service 3' } })
    }
    for (const body of [{ id: a.id, version: 1, kind: 'service', confirm: 'service 3' }, { id: a.id, kind: 'service', recipients: 3, confirm: 'service 3' }, { id: a.id, version: 1, kind: 'other', recipients: 3, confirm: 'other 3' }]) {
      expect((await post('send', body)).status).toBe(400)
    }
    expect(server.requests).toHaveLength(asked)
    const { status, body } = await post('send', { id: a.id, version: 1, kind: 'service', recipients: 3, confirm: 'service 3' })
    expect(status).toBe(200)
    expect(body['announcement']).toMatchObject({ status: 'sending', recipients: 3, queued: 3, sent: 0 })
    expect(server.bodies.at(-1)).toEqual({ id: a.id, version: 1, kind: 'service', recipients: 3 })
    expect(logged).toContain('announcements: sending of a service announcement to 3 account(s) started')
  })

  it('says in words why the server would not send', async () => {
    const a = await draft()
    const send = (over: object = {}) => post('send', { id: a.id, version: 1, kind: 'service', recipients: 3, confirm: 'service 3', ...over })
    expect(await send()).toEqual({ status: 409, body: { message: 'This version has not been sent as a test yet. Send a test first.' } })
    await post('test', { id: a.id, version: 1, email: OWNER })
    server.recipients.service = 4
    expect(await send()).toEqual({ status: 409, body: { message: 'The number of accounts has changed: it would now go to 4. Nothing was sent. Read the count again and confirm it.' } })
    expect(await send({ version: 2 })).toEqual({ status: 409, body: { message: 'The announcement was changed after this page read it. Nothing was done. Open it again.' } })
    server.recipients.service = 0
    expect(await send({ recipients: 0, confirm: 'service 0' })).toEqual({ status: 409, body: { message: 'No account would get this announcement. Nothing was sent.' } })
    server.recipients.service = 3
    expect((await send()).status).toBe(200)
    expect(await send()).toEqual({ status: 409, body: { message: 'This announcement is no longer a draft: its sending has started, and it cannot be changed, tested or sent again.' } })
    expect((await post('save', { id: a.id, kind: 'service', texts: { en } })).status).toBe(409)
    expect((await post('delete', { id: a.id })).status).toBe(409)
  })

  it('stops a send and resumes it, and deletes a draft', async () => {
    const a = await draft()
    await post('test', { id: a.id, version: 1, email: OWNER })
    await post('send', { id: a.id, version: 1, kind: 'service', recipients: 3, confirm: 'service 3' })
    expect((await post('resume', { id: a.id })).body).toEqual({ message: 'This announcement is not stopped.' })
    expect((await post('stop', { id: a.id })).body['announcement']).toMatchObject({ status: 'stopped' })
    expect((await post('stop', { id: a.id })).body).toEqual({ message: 'This announcement is not being sent.' })
    expect((await post('resume', { id: a.id })).body['announcement']).toMatchObject({ status: 'sending' })
    const b = await draft()
    expect(await post('delete', { id: b.id })).toEqual({ status: 200, body: { deleted: true } })
    expect(server.announcements.map((x) => x.id)).toEqual([a.id])
    for (const path of ['delete', 'preview', 'stop', 'resume']) expect((await post(path, { id: 'x' })).status).toBe(400)
  })

  it('says it is not connected while the address or the token is not set, and asks the server nothing', async () => {
    for (const missing of [{ ADMIN_WRITE_TOKEN: '' }, { LEARNER_APP_URL: '' }] as Partial<Env>[]) {
      env = { ...env, LEARNER_APP_URL: SERVER, ADMIN_WRITE_TOKEN: WRITE_TOKEN, ...missing }
      expect(await answer(await admin('GET', '/api/admin/announcements'))).toEqual({ status: 200, body: { connected: false } })
      expect((await post('save', { kind: 'service', texts: { en } })).status).toBe(503)
      expect((await post('send', { id: 1, version: 1, kind: 'service', recipients: 3, confirm: 'service 3' })).status).toBe(503)
    }
    expect(server.requests).toEqual([])
  })

  it('says what went wrong when the server refuses or cannot be reached, and logs a status only', async () => {
    server.writeToken = 'another'.repeat(6)
    expect(await answer(await admin('GET', '/api/admin/announcements'))).toEqual({
      status: 502,
      body: { message: 'The app’s server answered 404. Check that ADMIN_WRITE_TOKEN is the same in both deployments, and that the app’s server has announcements.' },
    })
    server.writeToken = WRITE_TOKEN
    expect(await post('preview', { id: 99 })).toEqual({ status: 404, body: { message: 'The app’s server has no such announcement.' } })
    server.failure = { status: 500, body: `a body that names ${OWNER} and must not be logged` }
    expect((await post('test', { id: 1, version: 1, email: OWNER })).status).toBe(502)
    expect(logged.at(-1)).toBe('announcements: the app\'s server answered 500')
    server.failure = new TypeError('fetch failed')
    expect(await post('stop', { id: 1 })).toEqual({ status: 502, body: { message: 'The app’s server could not be reached.' } })
    expect(logged.join('\n')).not.toContain('owner')
  })
})

describe('the prepared notice the form offers (#215)', () => {
  const terms = { subject: 'The terms of use have changed', body: 'Hello,\n\nthe terms have changed.' }
  const older = { subject: 'An older change', body: 'Hello.' }
  const prepared = () => admin('GET', '/api/admin/announcements/prepared')
  const github = () => calls.filter((call) => call.url.startsWith(GITHUB))

  beforeEach(() => {
    env = { ...env, NOTICES_REPO: NOTICES, NOTICES_PATH: 'notices', GITHUB_APP_PRIVATE_KEY: appKey }
    gh = new FakeGitHub({ 'notices/2026-09-01-older.md': noticeFile('Older', { en: older }), 'notices/2026-10-11-new-terms.md': noticeFile('New terms of use', { en: terms, bg: { subject: 'Условията са променени', body: 'Здравейте.' } }) }, NOTICES)
  })

  it('is for admins only', async () => {
    expect((await as('ivan@example.com', 'GET', '/api/admin/announcements/prepared')).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('is the newest notice no announcement has used, read with the GitHub App from the notices’ repository', async () => {
    expect(await answer(await prepared())).toEqual({
      status: 200,
      body: { notice: { file: '2026-10-11-new-terms.md', date: '2026-10-11', title: 'New terms of use', texts: { en: terms, bg: { subject: 'Условията са променени', body: 'Здравейте.' } } } },
    })
    expect(github().map((call) => call.url.slice(GITHUB.length).split('?')[0])).toEqual(['/app/installations/2/access_tokens', `/repos/${NOTICES}/git/ref/heads/main`, `/repos/${NOTICES}/contents/notices`, '/graphql'])
    // Nothing is written to GitHub, and nothing of a notice is logged.
    expect(github().filter((call) => (call.init.method ?? 'GET') !== 'GET').map((call) => call.url.slice(GITHUB.length))).toEqual(['/app/installations/2/access_tokens', '/graphql'])
    expect(logged.join('\n')).not.toContain('terms')
  })

  it('counts a notice as used once an announcement has its English subject, a draft too, and then offers the one before it', async () => {
    expect((await post('save', { kind: 'service', texts: { en: terms } })).status).toBe(200)
    expect((await answer(await prepared())).body).toMatchObject({ notice: { file: '2026-09-01-older.md' } })
    // An announcement of the other kind with that subject uses it as well: the text has gone out, or is about to.
    expect((await post('save', { kind: 'news', texts: { en: older } })).status).toBe(200)
    expect((await answer(await prepared())).body).toEqual({ notice: null })
    // The draft deleted, the notice is unused again.
    expect((await post('delete', { id: 2 })).status).toBe(200)
    expect((await answer(await prepared())).body).toMatchObject({ notice: { file: '2026-09-01-older.md' } })
  })

  it('offers nothing and asks nobody when the notices or the announcements are not set up', async () => {
    for (const without of [{ NOTICES_REPO: '' }, { NOTICES_PATH: '' }, { ADMIN_WRITE_TOKEN: '' }]) {
      const all = env
      env = { ...env, ...without }
      expect(await answer(await prepared())).toEqual({ status: 200, body: { notice: null } })
      env = all
    }
    expect(calls).toEqual([])
    // The announcements are read, and then nothing is asked of GitHub without the App's key.
    env = { ...env, GITHUB_APP_PRIVATE_KEY: '' }
    expect(await answer(await prepared())).toEqual({ status: 200, body: { notice: null } })
    expect(github()).toEqual([])
  })

  it('offers nothing when GitHub does not give the notices, and says only the call and its status in the log', async () => {
    env = { ...env, NOTICES_REPO: 'an-owner/not-installed' }
    expect(await answer(await prepared())).toEqual({ status: 200, body: { notice: null } })
    expect(logged).toContain('prepared notices: not read, GitHub ref: 404')
  })

  it('does not decide what is used without the announcements: the server’s failure is the answer', async () => {
    server.failure = { status: 500, body: 'down' }
    expect((await prepared()).status).toBe(502)
    expect(github()).toEqual([])
  })
})

describe('Translate (#215)', () => {
  const english = { subject: 'New: search the whole dictionary', body: 'Hello,\n\nyou can now search every word.\nTry it: https://example.com/search' }
  const names: Record<string, string> = { Bulgarian: 'bg', German: 'de', Spanish: 'es' }
  /** A translation that fits: the English with the language's code before it, the address kept. */
  const fits = (_name: string, input: unknown) => {
    const { language, subject, body } = input as { language: string; subject: string; body: string }
    return { subject: `[${names[language]}] ${subject}`, body: `[${names[language]}] ${body}` }
  }
  const translate = async (body: unknown) => {
    const res = await admin('POST', '/api/admin/announcements/translate', body)
    return { status: res.status, body: (await res.json()) as AnnouncementTranslation & { message?: string } }
  }
  const all = { ...english, languages: ['bg', 'de', 'es'] }

  beforeEach(async () => {
    env = { ...env, FEEDBACK_AI_KEY: KEY, FEEDBACK_AI_URL: `${MODEL}/api/v1`, FEEDBACK_AI_DAILY_CALLS: '5' }
    model.answer = fits
    await as('admin@example.com', 'GET', '/api/me')
    await putSetting(env.DB, AI_SWITCH, 'on', 'admin@example.com', 't')
  })

  it('is for admins only', async () => {
    expect((await as('ivan@example.com', 'POST', '/api/admin/announcements/translate', all)).status).toBe(403)
    expect(model.requests).toEqual([])
  })

  it('translates the English text into each language asked for, with one counted call each, and saves nothing', async () => {
    const { status, body } = await translate({ subject: ` ${english.subject} `, body: `${english.body}\n`, languages: ['bg', 'es'] })
    expect(status).toBe(200)
    expect(body).toEqual({ texts: { bg: { subject: `[bg] ${english.subject}`, body: `[bg] ${english.body}` }, es: { subject: `[es] ${english.subject}`, body: `[es] ${english.body}` } }, failed: {} })
    expect(model.requests).toHaveLength(2)
    expect(await aiCallsToday(env.DB, new Date('2026-10-05T12:00:00Z'))).toBe(2)
    // The learner app's server was asked nothing: no announcement was written or changed.
    expect(server.requests).toEqual([])
  })

  it('sends the model the announcement’s own text and the language, and nothing else of the request or of anyone', async () => {
    await translate(all)
    expect(model.requests).toHaveLength(3)
    expect(model.requests.map((_, i) => model.inputOf(i))).toEqual([{ language: 'Bulgarian', ...english }, { language: 'German', ...english }, { language: 'Spanish', ...english }])
    for (const request of model.requests) {
      expect(request.url).toBe(`${MODEL}/api/v1/chat/completions`)
      const sent = JSON.stringify(request.body)
      for (const never of ['admin@example.com', 'ivan@example.com', WRITE_TOKEN, READ_TOKEN]) expect(sent).not.toContain(never)
    }
    // Nothing of a text is logged.
    expect(logged.join('\n')).not.toContain('search')
    expect(logged).toContain('announcements: 3 of 3 translation(s) written')
  })

  it('takes a subject, a body and languages, and no other field', async () => {
    for (const bad of [
      { ...all, email: 'someone@example.com' },
      { ...all, texts: { en: english } },
      { ...all, id: 1 },
      { ...all, subject: '' },
      { ...all, body: 7 },
      { ...all, subject: 'One\nTwo' },
      { ...all, subject: 's'.repeat(MAX_ANNOUNCEMENT_SUBJECT + 1) },
      { ...english },
      { ...english, languages: [] },
      { ...english, languages: 'bg' },
      { ...english, languages: ['en'] },
      { ...english, languages: ['bg', 'bg'] },
      { ...english, languages: ['bg', 'fr'] },
    ]) {
      expect((await translate(bad)).status).toBe(400)
    }
    expect((await translate({ ...all, email: 'someone@example.com' })).body.message).toBe('a translation is asked for with a subject, a body and languages, and no email')
    expect(model.requests).toEqual([])
    expect(await aiCallsToday(env.DB, new Date('2026-10-05T12:00:00Z'))).toBe(0)
  })

  it('asks nobody while the AI help is not set up or is switched off, and says which', async () => {
    await putSetting(env.DB, AI_SWITCH, 'off', 'admin@example.com', 't')
    expect((await translate(all)).body).toEqual({ texts: {}, failed: { bg: 'off', de: 'off', es: 'off' } })
    env = { ...env, FEEDBACK_AI_KEY: '' }
    expect((await translate(all)).body).toEqual({ texts: {}, failed: { bg: 'not-set-up', de: 'not-set-up', es: 'not-set-up' } })
    expect(model.requests).toEqual([])
    expect(await aiCallsToday(env.DB, new Date('2026-10-05T12:00:00Z'))).toBe(0)
  })

  it('counts toward the AI help’s daily allowance: what is left goes to the first languages, and then nobody is asked', async () => {
    env = { ...env, FEEDBACK_AI_DAILY_CALLS: '4' }
    expect(Object.keys((await translate(all)).body.texts)).toEqual(['bg', 'de', 'es'])
    const second = await translate(all)
    expect(second.body.failed).toEqual({ de: 'limit', es: 'limit' })
    expect(Object.keys(second.body.texts)).toEqual(['bg'])
    expect(model.requests).toHaveLength(4)
    expect((await translate(all)).body).toEqual({ texts: {}, failed: { bg: 'limit', de: 'limit', es: 'limit' } })
    expect(model.requests).toHaveLength(4)
  })

  it('refuses a bad or an over-long answer for its language, cuts nothing, and keeps the others', async () => {
    model.answer = (name, input) => {
      const { language } = input as { language: string }
      if (language === 'Bulgarian') return { ...fits(name, input), body: 'б'.repeat(10_001) }
      if (language === 'German') return { subject: 'Eins\nZwei', body: 'Hallo. https://example.com/search' }
      return fits(name, input)
    }
    const { body } = await translate(all)
    expect(body.failed).toEqual({ bg: 'too-long', de: 'unfit' })
    expect(body.texts).toEqual({ es: { subject: `[es] ${english.subject}`, body: `[es] ${english.body}` } })
    model.answer = () => ({ subject: 'Neu', body: 'Hallo. https://example.com/suche' })
    expect((await translate({ ...english, languages: ['de'] })).body).toEqual({ texts: {}, failed: { de: 'address' } })
  })

  it('says why when the service does not answer, is late or refuses', async () => {
    for (const [failure, why] of [[{ status: 503 }, 'unreachable'], ['late', 'late'], [{ status: 400 }, 'refused'], [{ status: 200, body: 'not json' }, 'unfit']] as const) {
      model.failure = failure
      expect((await translate({ ...english, languages: ['de'] })).body).toEqual({ texts: {}, failed: { de: why } })
    }
  })
})
