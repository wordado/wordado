import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AccountDetails, AccountSeries, AccountSplits, AccountStats, AccountStatsView, AccountSweepView } from '../../shared/hosted'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { insertReviewer } from '../db'
import { FakeLearnerApp } from '../test/fakeLearnerApp'
import { testKeys } from '../test/jwt'
import { resetDb, startPlatform, testDeps } from '../test/platform'

const READ_TOKEN = 't'.repeat(40)
const WRITE_TOKEN = 'w'.repeat(40)
const SERVER = 'https://app.test'
const CREATED = Date.parse('2026-01-05T09:00:00Z')
const SIGNED_IN = Date.parse('2026-09-30T18:00:00Z')

const DETAILS: AccountDetails = {
  lastStudiedAt: SIGNED_IN, daysStudied30: 19, newsConsent: 'given', newsConsentAt: CREATED, newsConsentLanguage: 'bg',
  reminders: [{ minute: 1170, tzOffsetMin: 180, paused: false }, { minute: 480, tzOffsetMin: -300, paused: true }], devices: 2, sweepNotBefore: SIGNED_IN + 731 * 86_400_000,
}
const UNUSED: AccountDetails = { lastStudiedAt: null, daysStudied30: 0, newsConsent: 'none', newsConsentAt: null, newsConsentLanguage: null, reminders: [], devices: 0, sweepNotBefore: null }
const SERIES: AccountSeries = { readAt: SIGNED_IN, accounts: 120, weekStart: Date.parse('2026-09-28T00:00:00Z'), madeByWeek: [3, 0, 5], dayStart: Date.parse('2026-09-30T00:00:00Z'), studiedByDay: [7, 9, 0, 4] }
const SPLITS: AccountSplits = {
  readAt: SIGNED_IN,
  news: [{ language: 'bg', given: 6, withdrawn: 1, none: 40 }, { language: null, given: 0, withdrawn: 0, none: 8 }],
  reminders: [{ language: 'bg', sending: 5, paused: 2 }],
}

let base: Env
let env: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
let server: FakeLearnerApp
let logged: string[]
/** What `fetch` was called with, beside what the fake records. */
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
  server.accounts.set('ana@example.com', { createdAt: CREATED, lastSignInAt: SIGNED_IN, details: DETAILS })
  server.accounts.set('ben@example.com', { createdAt: CREATED, lastSignInAt: null, details: UNUSED })
  server.series = SERIES
  server.splits = SPLITS
  logged = []
  calls = []
  await insertReviewer(env.DB, { email: 'ivan@example.com', name: 'Ivan', languages: ['bg'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
})

const as = async (email: string, method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}) =>
  createApp(testDeps(env, { fetch: (url, init = {}) => (calls.push({ url, init }), server.fetch(url, init)), log: (line) => logged.push(line) })).request(path, {
    method,
    headers: {
      'cf-access-jwt-assertion': await keys.token(email, env),
      ...(body !== undefined ? { origin: env.APP_ORIGIN, 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

// The admin reviewer is created on their first request (GET /api/me), as app.ts does for ADMIN_EMAIL.
const admin = async (method: 'GET' | 'POST', path: string, body?: unknown, headers?: Record<string, string>) => {
  await as('admin@example.com', 'GET', '/api/me')
  return as('admin@example.com', method, path, body, headers)
}
const answer = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> })

describe('the Accounts tab’s routes (#187)', () => {
  it('are for admins only', async () => {
    expect((await as('ivan@example.com', 'GET', '/api/admin/accounts/sweep')).status).toBe(403)
    expect((await as('ivan@example.com', 'GET', '/api/admin/accounts/stats')).status).toBe(403)
    expect((await as('ivan@example.com', 'GET', '/api/admin/accounts/series')).status).toBe(403)
    expect((await as('ivan@example.com', 'GET', '/api/admin/accounts/splits')).status).toBe(403)
    expect((await as('ivan@example.com', 'POST', '/api/admin/accounts/lookup', { email: 'ana@example.com' })).status).toBe(403)
    expect((await as('ivan@example.com', 'POST', '/api/admin/accounts/delete', { email: 'ana@example.com', confirm: true })).status).toBe(403)
    expect(server.requests).toEqual([])
    expect(server.accounts.has('ana@example.com')).toBe(true)
  })

  it('looks an account up by its address: when it was made and last signed in, how it is used, and nothing else', async () => {
    expect(await answer(await admin('POST', '/api/admin/accounts/lookup', { email: ' Ana@Example.com ' }))).toEqual({ status: 200, body: { found: true, createdAt: CREATED, lastSignInAt: SIGNED_IN, details: DETAILS } })
    expect(await answer(await admin('POST', '/api/admin/accounts/lookup', { email: 'ben@example.com' }))).toEqual({ status: 200, body: { found: true, createdAt: CREATED, lastSignInAt: null, details: UNUSED } })
    expect(await answer(await admin('POST', '/api/admin/accounts/lookup', { email: 'nobody@example.com' }))).toEqual({ status: 200, body: { found: false } })
    // Anything more the server might say of an account is not passed on.
    const said = { found: true, createdAt: CREATED, lastSignInAt: null, id: 'user-1', email: 'ana@example.com', details: { ...DETAILS, id: 'user-1', endpoints: ['https://push.example.com/a'], reminders: [{ minute: 60, tzOffsetMin: 0, paused: false, endpoint: 'https://push.example.com/a' }] } }
    const chatty = createApp(testDeps(env, { fetch: async () => new Response(JSON.stringify(said), { status: 200 }) }))
    const res = await chatty.request('/api/admin/accounts/lookup', { method: 'POST', headers: { 'cf-access-jwt-assertion': await keys.token('admin@example.com', env), origin: env.APP_ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ana@example.com' }) })
    expect(await res.json()).toEqual({ found: true, createdAt: CREATED, lastSignInAt: null, details: { ...DETAILS, reminders: [{ minute: 60, tzOffsetMin: 0, paused: false }] } })
  })

  it('passes on the two dates of an account from a server that says no more, and refuses details that are not details (#209)', async () => {
    // A server from before #209: the lookup works as it did, and the page is told there is no more.
    server.accounts.set('ana@example.com', { createdAt: CREATED, lastSignInAt: SIGNED_IN })
    expect(await answer(await admin('POST', '/api/admin/accounts/lookup', { email: 'ana@example.com' }))).toEqual({ status: 200, body: { found: true, createdAt: CREATED, lastSignInAt: SIGNED_IN, details: null } })
    expect(logged).toEqual([])
    const wrong: unknown[] = [
      null, 'none', [],
      { ...DETAILS, daysStudied30: undefined }, { ...DETAILS, lastStudiedAt: 'yesterday' }, { ...DETAILS, newsConsent: 'maybe' }, { ...DETAILS, newsConsentLanguage: 'xx' },
      { ...DETAILS, devices: -1 }, { ...DETAILS, reminders: {} }, { ...DETAILS, reminders: [{ minute: 1440, tzOffsetMin: 0, paused: false }] },
      { ...DETAILS, reminders: [{ minute: 60, tzOffsetMin: 900, paused: false }] }, { ...DETAILS, reminders: [{ minute: 60, tzOffsetMin: 0 }] },
      { ...DETAILS, reminders: Array.from({ length: 11 }, () => ({ minute: 60, tzOffsetMin: 0, paused: false })) },
    ]
    for (const details of wrong) {
      server.failure = { status: 200, body: JSON.stringify({ found: true, createdAt: CREATED, lastSignInAt: null, details }) }
      expect(await answer(await admin('POST', '/api/admin/accounts/lookup', { email: 'ana@example.com' }))).toEqual({ status: 502, body: { message: 'The app’s server gave an answer the review app does not understand.' } })
    }
  })

  it('sends the address in the body and the token in a header, to the server it was made for and with the token that changes things', async () => {
    await admin('POST', '/api/admin/accounts/lookup', { email: 'ana@example.com' })
    expect(server.requests).toEqual(['POST /v1/admin/accounts/lookup'])
    expect(server.bodies).toEqual([{ email: 'ana@example.com' }])
    expect(calls[0]!.url).toBe(`${SERVER}/v1/admin/accounts/lookup`)
    expect(calls[0]!.url).not.toContain('ana')
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe(`Bearer ${WRITE_TOKEN}`)
    expect(calls[0]!.init.redirect).toBe('manual')
  })

  it('deletes the account an address names, only when the request confirms it', async () => {
    for (const body of [{ email: 'ana@example.com' }, { email: 'ana@example.com', confirm: 'yes' }, { confirm: true }, { email: 'ana', confirm: true }, { email: 7, confirm: true }]) {
      expect((await admin('POST', '/api/admin/accounts/delete', body)).status).toBe(400)
    }
    expect(server.requests).toEqual([])
    expect(await answer(await admin('POST', '/api/admin/accounts/delete', { email: 'Ana@example.com ', confirm: true }))).toEqual({ status: 200, body: { deleted: true } })
    expect(server.bodies).toEqual([{ email: 'ana@example.com', confirm: true }])
    expect([...server.accounts.keys()]).toEqual(['ben@example.com'])
    // Asked again there is nothing to delete, and it says so.
    expect(await answer(await admin('POST', '/api/admin/accounts/delete', { email: 'ana@example.com', confirm: true }))).toEqual({ status: 200, body: { deleted: false } })
  })

  it('logs that an account was deleted, and never an address', async () => {
    await admin('POST', '/api/admin/accounts/lookup', { email: 'ana@example.com' })
    await admin('POST', '/api/admin/accounts/delete', { email: 'ana@example.com', confirm: true })
    expect(logged).toEqual(['accounts: 1 account deleted'])
    server.failure = { status: 500, body: 'a body that names ana@example.com and must not be logged' }
    expect((await admin('POST', '/api/admin/accounts/lookup', { email: 'ana@example.com' })).status).toBe(502)
    expect(logged.at(-1)).toBe('accounts: the app\'s server answered 500')
    expect(logged.join('\n')).not.toContain('ana')
  })

  it('gives the sweep’s counts', async () => {
    server.sweep = { months: 24, batch: 50, due: 3, undated: 1, taken: 12, lastRunAt: SIGNED_IN, lastTaken: 2 }
    const res = await admin('GET', '/api/admin/accounts/sweep')
    expect((await res.json()) as AccountSweepView).toEqual({ connected: true, sweep: server.sweep })
    expect(server.requests).toEqual(['GET /v1/admin/accounts/sweep'])
  })

  it('gives the counts of accounts and their use, and nothing more the server might say (#206)', async () => {
    const stats: AccountStats = { readAt: SIGNED_IN, accounts: 120, made7: 4, made30: 31, studied7: 40, studied30: 75, newsGiven: 50, newsWithdrawn: 3, newsNone: 67, reminders: 22 }
    server.stats = stats
    const res = await admin('GET', '/api/admin/accounts/stats')
    expect((await res.json()) as AccountStatsView).toEqual({ connected: true, stats })
    expect(server.requests).toEqual(['GET /v1/admin/accounts/stats'])
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe(`Bearer ${WRITE_TOKEN}`)
    expect(logged).toEqual([])
    server.failure = { status: 200, body: JSON.stringify({ ...stats, newest: 'ana@example.com', ids: ['user-1'] }) }
    expect(await answer(await admin('GET', '/api/admin/accounts/stats'))).toEqual({ status: 200, body: { connected: true, stats } })
    // A count that is missing or is no count is an answer it does not understand.
    for (const wrong of [{ ...stats, studied7: undefined }, { ...stats, accounts: '120' }, { ...stats, reminders: -1 }, { ...stats, readAt: null }]) {
      server.failure = { status: 200, body: JSON.stringify(wrong) }
      expect(await answer(await admin('GET', '/api/admin/accounts/stats'))).toEqual({ status: 502, body: { message: 'The app’s server gave an answer the review app does not understand.' } })
    }
    server.failure = new TypeError('fetch failed')
    expect(await answer(await admin('GET', '/api/admin/accounts/stats'))).toEqual({ status: 502, body: { message: 'The app’s server could not be reached.' } })
  })

  it('gives the accounts by week and by day and by language, and nothing more the server might say (#209)', async () => {
    expect(await answer(await admin('GET', '/api/admin/accounts/series'))).toEqual({ status: 200, body: { connected: true, series: SERIES } })
    expect(await answer(await admin('GET', '/api/admin/accounts/splits'))).toEqual({ status: 200, body: { connected: true, splits: SPLITS } })
    expect(server.requests).toEqual(['GET /v1/admin/accounts/series', 'GET /v1/admin/accounts/splits'])
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe(`Bearer ${WRITE_TOKEN}`)
    expect(logged).toEqual([])
    server.failure = { status: 200, body: JSON.stringify({ ...SERIES, newest: 'ana@example.com', ids: ['user-1'] }) }
    expect(await answer(await admin('GET', '/api/admin/accounts/series'))).toEqual({ status: 200, body: { connected: true, series: SERIES } })
    server.failure = { status: 200, body: JSON.stringify({ ...SPLITS, news: SPLITS.news.map((row) => ({ ...row, ids: ['user-1'] })), newest: 'ana@example.com' }) }
    expect(await answer(await admin('GET', '/api/admin/accounts/splits'))).toEqual({ status: 200, body: { connected: true, splits: SPLITS } })
    // A series or a split that is not one is an answer it does not understand.
    const unfit = { status: 502, body: { message: 'The app’s server gave an answer the review app does not understand.' } }
    for (const wrong of [{ ...SERIES, madeByWeek: undefined }, { ...SERIES, madeByWeek: [] }, { ...SERIES, studiedByDay: [1, -1] }, { ...SERIES, studiedByDay: [1, 'ana@example.com'] }, { ...SERIES, studiedByDay: Array.from({ length: 401 }, () => 0) }, { ...SERIES, weekStart: null }]) {
      server.failure = { status: 200, body: JSON.stringify(wrong) }
      expect(await answer(await admin('GET', '/api/admin/accounts/series'))).toEqual(unfit)
    }
    for (const wrong of [{ ...SPLITS, news: undefined }, { ...SPLITS, news: [{ language: 'xx', given: 1, withdrawn: 0, none: 0 }] }, { ...SPLITS, news: [{ language: 'bg', given: 1, withdrawn: 0 }] }, { ...SPLITS, reminders: [{ language: 'bg', sending: '5', paused: 2 }] }, { ...SPLITS, reminders: ['bg'] }]) {
      server.failure = { status: 200, body: JSON.stringify(wrong) }
      expect(await answer(await admin('GET', '/api/admin/accounts/splits'))).toEqual(unfit)
    }
  })

  it('says so when the server is from before it had the series and the splits; the counts and the lookup answer as before (#209)', async () => {
    server.series = null
    server.splits = null
    server.accounts.set('ana@example.com', { createdAt: CREATED, lastSignInAt: SIGNED_IN })
    const older = { status: 502, body: { message: 'The app’s server answered 404. It may be from before it had these numbers: deploy it too.' } }
    expect(await answer(await admin('GET', '/api/admin/accounts/series'))).toEqual(older)
    expect(await answer(await admin('GET', '/api/admin/accounts/splits'))).toEqual(older)
    expect((await answer(await admin('GET', '/api/admin/accounts/stats'))).body).toMatchObject({ connected: true })
    expect((await answer(await admin('GET', '/api/admin/accounts/sweep'))).body).toMatchObject({ connected: true })
    expect(await answer(await admin('POST', '/api/admin/accounts/lookup', { email: 'ana@example.com' }))).toEqual({ status: 200, body: { found: true, createdAt: CREATED, lastSignInAt: SIGNED_IN, details: null } })
    expect(await answer(await admin('POST', '/api/admin/accounts/delete', { email: 'ana@example.com', confirm: true }))).toEqual({ status: 200, body: { deleted: true } })
  })

  it('says it is not connected while the address or the token is not set, and asks the server nothing', async () => {
    for (const missing of [{ ADMIN_WRITE_TOKEN: '' }, { ADMIN_WRITE_TOKEN: '  ' }, { LEARNER_APP_URL: '' }] as Partial<Env>[]) {
      env = { ...env, LEARNER_APP_URL: SERVER, ADMIN_WRITE_TOKEN: WRITE_TOKEN, ...missing }
      expect(await answer(await admin('GET', '/api/admin/accounts/sweep'))).toEqual({ status: 200, body: { connected: false } })
      expect(await answer(await admin('GET', '/api/admin/accounts/stats'))).toEqual({ status: 200, body: { connected: false } })
      expect(await answer(await admin('GET', '/api/admin/accounts/series'))).toEqual({ status: 200, body: { connected: false } })
      expect(await answer(await admin('GET', '/api/admin/accounts/splits'))).toEqual({ status: 200, body: { connected: false } })
      expect((await admin('POST', '/api/admin/accounts/lookup', { email: 'ana@example.com' })).status).toBe(503)
      expect((await admin('POST', '/api/admin/accounts/delete', { email: 'ana@example.com', confirm: true })).status).toBe(503)
    }
    // The token that reads feedback opens nothing here: with it alone the tab is not connected.
    env = { ...env, LEARNER_APP_URL: SERVER, FEEDBACK_READ_TOKEN: READ_TOKEN, ADMIN_WRITE_TOKEN: '' }
    expect(await answer(await admin('GET', '/api/admin/accounts/sweep'))).toEqual({ status: 200, body: { connected: false } })
    expect(server.requests).toEqual([])
  })

  it('says what went wrong when the server refuses or cannot be reached', async () => {
    server.writeToken = 'another'.repeat(6)
    expect(await answer(await admin('POST', '/api/admin/accounts/lookup', { email: 'ana@example.com' }))).toEqual({
      status: 502,
      body: { message: 'The app’s server answered 404. Check that ADMIN_WRITE_TOKEN is the same in both deployments.' },
    })
    server.writeToken = WRITE_TOKEN
    server.ambiguous.add('ana@example.com')
    for (const [path, body] of [['lookup', { email: 'ana@example.com' }], ['delete', { email: 'ana@example.com', confirm: true }]] as const) {
      expect(await answer(await admin('POST', `/api/admin/accounts/${path}`, body))).toEqual({ status: 409, body: { message: 'Two accounts answer to this address, and the app’s server cannot tell which is meant. Nothing was deleted.' } })
    }
    server.failure = new TypeError('fetch failed')
    expect(await answer(await admin('GET', '/api/admin/accounts/sweep'))).toEqual({ status: 502, body: { message: 'The app’s server could not be reached.' } })
    expect(await answer(await admin('POST', '/api/admin/accounts/delete', { email: 'ana@example.com', confirm: true }))).toEqual({ status: 502, body: { message: 'The app’s server could not be reached.' } })
    server.failure = { status: 200, body: '{"found":"yes"}' }
    expect(await answer(await admin('POST', '/api/admin/accounts/lookup', { email: 'ana@example.com' }))).toEqual({ status: 502, body: { message: 'The app’s server gave an answer the review app does not understand.' } })
    server.failure = { status: 200, body: '{"deleted":1}' }
    expect((await admin('POST', '/api/admin/accounts/delete', { email: 'ana@example.com', confirm: true })).status).toBe(502)
    server.failure = { status: 200, body: '{"months":24}' }
    expect((await admin('GET', '/api/admin/accounts/sweep')).status).toBe(502)
  })

  it('refuses a request from another origin, like every request that changes something', async () => {
    const res = await admin('POST', '/api/admin/accounts/delete', { email: 'ana@example.com', confirm: true }, { origin: 'https://elsewhere.example.com' })
    expect(res.status).toBe(403)
    expect(server.accounts.has('ana@example.com')).toBe(true)
  })
})
