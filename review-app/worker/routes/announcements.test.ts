import { MAX_ANNOUNCEMENT_SUBJECT } from '@wordado/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Announcement, AnnouncementPreview, AnnouncementsView } from '../../shared/hosted'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { insertReviewer } from '../db'
import { FakeLearnerApp } from '../test/fakeLearnerApp'
import { testKeys } from '../test/jwt'
import { resetDb, startPlatform, testDeps } from '../test/platform'

const READ_TOKEN = 't'.repeat(40)
const WRITE_TOKEN = 'w'.repeat(40)
const SERVER = 'https://app.test'
const OWNER = 'owner@example.com'
const en = { subject: 'The terms change on 1 December', body: 'Hello,\n\nthe terms change.' }

let base: Env
let env: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
let server: FakeLearnerApp
let logged: string[]
let calls: { url: string; init: RequestInit }[]

beforeAll(async () => {
  keys = await testKeys()
  const p = await startPlatform()
  base = { ...p.env, ACCESS_JWKS: keys.jwks }
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(async () => {
  await resetDb(base.DB)
  env = { ...base, LEARNER_APP_URL: `${SERVER}/`, FEEDBACK_READ_TOKEN: READ_TOKEN, ADMIN_WRITE_TOKEN: WRITE_TOKEN }
  server = new FakeLearnerApp(READ_TOKEN)
  server.writeToken = WRITE_TOKEN
  logged = []
  calls = []
  await insertReviewer(env.DB, { email: 'ivan@example.com', name: 'Ivan', languages: ['bg'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
})

const as = async (email: string, method: 'GET' | 'POST', path: string, body?: unknown) =>
  createApp(testDeps(env, { fetch: (url, init = {}) => (calls.push({ url, init }), server.fetch(url, init)), log: (line) => logged.push(line) })).request(path, {
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
