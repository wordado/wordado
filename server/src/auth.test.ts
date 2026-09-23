import { describe, expect, it } from 'vitest'
import { BASE_URL, harness } from '../test/harness'
import { OTP_SENDS_PER_MINUTE, SESSION_DAYS } from './auth'

const json = { 'content-type': 'application/json', origin: BASE_URL }

describe('sign-in (spec §8.6)', () => {
  it('signs in with an emailed code and opens a session the API accepts', async () => {
    const h = harness()
    const session = await h.signIn('ana@example.com')
    expect(h.codes).toEqual([{ email: 'ana@example.com', code: expect.stringMatching(/^\d{6}$/) }])
    const me = await session.get('/v1/me')
    expect(me.status).toBe(200)
    expect(me.body).toEqual({ userId: session.userId, email: 'ana@example.com', country: null, createdAt: expect.any(Number) })
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

  it('stores the self-declared country through update-user (spec §11)', async () => {
    const h = harness()
    const session = await h.signIn()
    const update = await session.post('/api/auth/update-user', { country: 'BG' })
    expect(update.status).toBe(200)
    expect((await session.get('/v1/me')).body.country).toBe('BG')
  })

  it("offers Google sign-in when it is configured, redirecting back to this server", async () => {
    const h = harness({ config: { google: { clientId: 'client-id.apps.googleusercontent.com', clientSecret: 'secret' } } })
    const reply = await h.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
    })
    expect(reply.status).toBe(200)
    const url = new URL(reply.body.url)
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('redirect_uri')).toBe(`${BASE_URL}/api/auth/callback/google`)
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
