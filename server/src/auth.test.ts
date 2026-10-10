import { describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../test/db'
import { BASE_URL, harness } from '../test/harness'
import { AUTH_MAX_BODY_BYTES, createApp } from './app'
import { createPool, pgDb } from './db/db'
import { createAuth, OTP_SENDS_PER_MINUTE, SESSION_DAYS } from './auth'

const json = { 'content-type': 'application/json', origin: BASE_URL }

describe('sign-in (spec §8.6)', () => {
  it('signs in with an emailed code and opens a session the API accepts', async () => {
    const h = harness()
    const session = await h.signIn('ana@example.com')
    expect(h.codes).toEqual([{ email: 'ana@example.com', code: expect.stringMatching(/^\d{6}$/) }])
    const me = await session.get('/v1/me')
    expect(me.status).toBe(200)
    expect(me.body).toEqual({ userId: session.userId, email: 'ana@example.com', createdAt: expect.any(Number) })
  })

  it('creates the user on the first sign-in and finds the same user on the next', async () => {
    const h = harness()
    const first = await h.signIn('ana@example.com')
    const second = await h.signIn('ana@example.com')
    expect(second.userId).toBe(first.userId)
    expect(await h.deps.db.query('select id from "user"')).toHaveLength(1)
  })

  it('keeps a session for 60 days', async () => {
    const h = harness()
    const session = await h.signIn()
    const [row] = await h.deps.db.query<{ days: number }>(
      `select round(extract(epoch from ("expiresAt" - now())) / 86400)::int as days from session where "userId" = $1`,
      [session.userId],
    )
    expect(row?.days).toBe(60)
  })

  it('extends the session on an ordinary API call once a day of use has passed', async () => {
    const h = harness()
    const session = await h.signIn()
    // Better Auth reads the real clock: age the session by two days in the database instead.
    await h.deps.db.query(`update session set "expiresAt" = "expiresAt" - interval '2 days' where "userId" = $1`, [session.userId])
    const reply = await session.get('/v1/me')
    expect(reply.status).toBe(200)
    const cookie = reply.headers.getSetCookie().find((c) => c.includes('session_token='))
    expect(cookie).toMatch(new RegExp(`Max-Age=${SESSION_DAYS * 86_400}\\b`))
    const [row] = await h.deps.db.query<{ days: number }>(
      `select round(extract(epoch from ("expiresAt" - now())) / 86400)::int as days from session where "userId" = $1`,
      [session.userId],
    )
    expect(row?.days).toBe(SESSION_DAYS)
  })

  it('sets no cookie on an API call while the session is fresh', async () => {
    const h = harness()
    const session = await h.signIn()
    expect((await session.get('/v1/me')).headers.getSetCookie()).toEqual([])
  })

  it('refuses a wrong code, and the right one after three wrong attempts', async () => {
    const h = harness()
    // A new address per attempt, so Better Auth's per-address limits cannot be what refuses.
    const from = (n: number) => ({ ...json, 'cf-connecting-ip': `10.9.1.${n}` })
    await h.request('/api/auth/email-otp/send-verification-otp', { method: 'POST', headers: from(0), body: JSON.stringify({ email: 'bo@example.com', type: 'sign-in' }) })
    await h.settle()
    const code = h.codes[0]!.code
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 1; i <= 3; i += 1) {
      const reply = await h.request('/api/auth/sign-in/email-otp', { method: 'POST', headers: from(i), body: JSON.stringify({ email: 'bo@example.com', otp: wrong }) })
      expect(reply.status).toBeGreaterThanOrEqual(400)
      expect(reply.status).not.toBe(429)
    }
    const late = await h.request('/api/auth/sign-in/email-otp', { method: 'POST', headers: from(4), body: JSON.stringify({ email: 'bo@example.com', otp: code }) })
    expect(late.status).toBeGreaterThanOrEqual(400)
    expect(late.status).not.toBe(429)
  })

  it('limits code requests from one address to three a minute', async () => {
    const h = harness()
    const headers = { ...json, 'cf-connecting-ip': '10.9.0.2' }
    const statuses: number[] = []
    for (let i = 0; i <= OTP_SENDS_PER_MINUTE; i += 1) {
      const reply = await h.request('/api/auth/email-otp/send-verification-otp', { method: 'POST', headers, body: JSON.stringify({ email: `c${i}@example.com`, type: 'sign-in' }) })
      statuses.push(reply.status)
    }
    expect(statuses).toEqual([200, 200, 200, 429])
  })

  it('answers 401 without a session', async () => {
    const h = harness()
    expect((await h.request('/v1/me')).status).toBe(401)
    expect((await h.request('/v1/me', { headers: { cookie: 'better-auth.session_token=forged' } })).status).toBe(401)
  })

  it('refuses a cross-site form post with the session cookie', async () => {
    const h = harness()
    const session = await h.signIn()
    const reply = await h.request('/v1/me', {
      method: 'POST',
      headers: { cookie: session.cookie, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1',
    })
    expect(reply.status).toBe(403)
  })

  it('keeps nothing of the age gate: a country sent to update-user is refused, and the table has no column for it (#166)', async () => {
    const h = harness()
    const session = await h.signIn()
    expect((await session.post('/api/auth/update-user', { country: 'BG' })).status).toBe(400)
    expect((await session.get('/v1/me')).body).toEqual({ userId: session.userId, email: session.email, createdAt: expect.any(Number) })
    expect(await h.deps.db.query(`select column_name from information_schema.columns where table_name = 'user' and column_name = 'country'`)).toEqual([])
  })

  it('keeps no address and no browser with a session (#166)', async () => {
    const h = harness()
    const session = await h.signIn()
    const reply = await h.request('/v1/me', { headers: { cookie: session.cookie, 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' } })
    expect(reply.status).toBe(200)
    expect(await h.deps.db.query('select "ipAddress", "userAgent" from session where "userId" = $1', [session.userId])).toEqual([{ ipAddress: null, userAgent: null }])
  })

  it('keys the request limits by a hash, never by the address (#166)', async () => {
    const h = harness()
    await h.signIn()
    const keys = await h.deps.db.query<{ key: string }>('select key from "rateLimit"')
    expect(keys.length).toBeGreaterThan(0)
    for (const { key } of keys) expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses the request that fills a limit window, and lets the next window through (#166)', async () => {
    const h = harness()
    const headers = { ...json, 'cf-connecting-ip': '198.51.100.9' }
    // A fresh address each time: the limit per address (src/signInLimit.ts) must not be the one that answers.
    let n = 0
    const send = () => h.request('/api/auth/email-otp/send-verification-otp', { method: 'POST', headers, body: JSON.stringify({ email: `ana-${++n}@example.com`, type: 'sign-in' }) })
    const statuses: number[] = []
    for (let i = 0; i < OTP_SENDS_PER_MINUTE + 1; i++) statuses.push((await send()).status)
    expect(statuses).toEqual([...Array<number>(OTP_SENDS_PER_MINUTE).fill(200), 429])
    h.clock.advance(60_000)
    expect((await send()).status).toBe(200)
  })

  it('keeps no name and no picture, whatever update-user sends (#163)', async () => {
    const h = harness()
    const session = await h.signIn()
    expect((await session.post('/api/auth/update-user', { name: 'Ana', image: 'https://example.com/ana.png' })).status).toBe(200)
    expect(await h.deps.db.query('select name, image from "user" where id = $1', [session.userId])).toEqual([{ name: '', image: null }])
  })

  it('keeps no tokens of a linked account, when it is created and when it is updated (#163)', async () => {
    const h = harness()
    const session = await h.signIn()
    const ctx = await createAuth(h.deps).$context
    const tokens = { accessToken: 'ya29.access', refreshToken: '1//refresh', idToken: 'eyJ.id', accessTokenExpiresAt: new Date(), scope: 'openid email' }
    const account = await ctx.internalAdapter.createAccount({ accountId: 'provider-sub', providerId: 'provider', userId: session.userId, ...tokens })
    const stored = () =>
      h.deps.db.query('select "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", scope from account where "providerId" = $1', ['provider'])
    const blank = { accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null, scope: null }
    expect(await stored()).toEqual([blank])
    await ctx.internalAdapter.updateAccount(account.id, tokens)
    expect(await stored()).toEqual([blank])
  })

  it(`refuses an auth request body over ${AUTH_MAX_BODY_BYTES} bytes`, async () => {
    const h = harness()
    const reply = await h.request('/api/auth/sign-in/email-otp', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'ana@example.com', otp: '123456', padding: 'x'.repeat(AUTH_MAX_BODY_BYTES) }),
    })
    expect(reply.status).toBe(413)
    expect(reply.body).toEqual({ error: 'too_large' })
  })

})

describe('the country pre-fill (spec §11)', () => {
  it("returns Cloudflare's country for the request, and null when it is unknown or Tor", async () => {
    const h = harness()
    expect((await h.request('/v1/country', { headers: { 'cf-ipcountry': 'BG' } })).body).toEqual({ country: 'BG' })
    expect((await h.request('/v1/country', { headers: { 'cf-ipcountry': 'XX' } })).body).toEqual({ country: null })
    expect((await h.request('/v1/country', { headers: { 'cf-ipcountry': 'T1' } })).body).toEqual({ country: null })
    expect((await h.request('/v1/country')).body).toEqual({ country: null })
  })
})

describe('health', () => {
  it('answers when the database does', async () => {
    expect((await harness().request('/health')).body).toEqual({ ok: true })
  })
})

describe('one request, one pool (as in the Worker)', () => {
  it('leaves nothing running on the pool once a request that needs no database is answered', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const db = pgDb(createPool(TEST_DATABASE_URL, 1))
      const app = createApp({ ...harness().deps, db })
      expect((await app.request('/v1/country', { headers: { 'cf-ipcountry': 'BG' } })).status).toBe(200)
      // The Worker ends the pool as soon as the response is out (src/worker.ts).
      await db.end()
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(errors.mock.calls.flat().map(String).filter((line) => line.includes('schema'))).toEqual([])
    } finally {
      errors.mockRestore()
    }
  })
})
