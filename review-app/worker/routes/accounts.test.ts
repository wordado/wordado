import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AccountSweepView } from '../../shared/hosted'
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
  server.accounts.set('ana@example.com', { createdAt: CREATED, lastSignInAt: SIGNED_IN })
  server.accounts.set('ben@example.com', { createdAt: CREATED, lastSignInAt: null })
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
    expect((await as('ivan@example.com', 'POST', '/api/admin/accounts/lookup', { email: 'ana@example.com' })).status).toBe(403)
    expect((await as('ivan@example.com', 'POST', '/api/admin/accounts/delete', { email: 'ana@example.com', confirm: true })).status).toBe(403)
    expect(server.requests).toEqual([])
    expect(server.accounts.has('ana@example.com')).toBe(true)
  })

  it('looks an account up by its address: when it was made and last signed in, and nothing else', async () => {
    expect(await answer(await admin('POST', '/api/admin/accounts/lookup', { email: ' Ana@Example.com ' }))).toEqual({ status: 200, body: { found: true, createdAt: CREATED, lastSignInAt: SIGNED_IN } })
    expect(await answer(await admin('POST', '/api/admin/accounts/lookup', { email: 'ben@example.com' }))).toEqual({ status: 200, body: { found: true, createdAt: CREATED, lastSignInAt: null } })
    expect(await answer(await admin('POST', '/api/admin/accounts/lookup', { email: 'nobody@example.com' }))).toEqual({ status: 200, body: { found: false } })
    // Anything more the server might say of an account is not passed on.
    const chatty = createApp(testDeps(env, { fetch: async () => new Response(JSON.stringify({ found: true, createdAt: CREATED, lastSignInAt: null, id: 'user-1', email: 'ana@example.com' }), { status: 200 }) }))
    const res = await chatty.request('/api/admin/accounts/lookup', { method: 'POST', headers: { 'cf-access-jwt-assertion': await keys.token('admin@example.com', env), origin: env.APP_ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ana@example.com' }) })
    expect(await res.json()).toEqual({ found: true, createdAt: CREATED, lastSignInAt: null })
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

  it('says it is not connected while the address or the token is not set, and asks the server nothing', async () => {
    for (const missing of [{ ADMIN_WRITE_TOKEN: '' }, { ADMIN_WRITE_TOKEN: '  ' }, { LEARNER_APP_URL: '' }] as Partial<Env>[]) {
      env = { ...env, LEARNER_APP_URL: SERVER, ADMIN_WRITE_TOKEN: WRITE_TOKEN, ...missing }
      expect(await answer(await admin('GET', '/api/admin/accounts/sweep'))).toEqual({ status: 200, body: { connected: false } })
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
