import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { BASE_URL, harness, type Harness, type Reply, type Session } from '../test/harness'
import { softAuthenticator, type SoftAuthenticator } from '../test/softAuthenticator'
import { PASSKEY_SIGN_INS_PER_MINUTE, passkeyOrigins } from './auth'

const DAY = 86_400_000

/** The cookies a reply sets, as a request sends them back. */
const cookiesOf = (reply: Reply): string =>
  reply.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')

const join = (...cookies: string[]): string => cookies.filter((c) => c !== '').join('; ')

let ips = 0
/** A request from its own address, so no test fills another's limit window. */
const from = (ip = `10.31.${++ips >> 8}.${ips & 255}`) => ({ origin: BASE_URL, 'cf-connecting-ip': ip })

/**
 * Adds a passkey to the session's account as the settings screen will: options, the device, verification. The
 * challenge travels in the cookie the options set.
 */
async function register(h: Harness, session: Session, device: SoftAuthenticator, extra: Record<string, unknown> = {}): Promise<Reply> {
  const options = await h.request('/api/auth/passkey/generate-register-options', { headers: { ...from(), cookie: session.cookie } })
  if (options.status !== 200) return options
  return h.request('/api/auth/passkey/verify-registration', {
    method: 'POST',
    headers: { ...from(), 'content-type': 'application/json', cookie: join(session.cookie, cookiesOf(options)) },
    body: JSON.stringify({ response: device.register(options.body), ...extra }),
  })
}

/** Signs in with the device's passkey, with no email and no session, as the sign-in screen will. */
async function authenticate(h: Harness, device: SoftAuthenticator, headers: Record<string, string> = {}): Promise<Reply> {
  const options = await h.request('/api/auth/passkey/generate-authenticate-options', { headers: from() })
  expect(options.status).toBe(200)
  return h.request('/api/auth/passkey/verify-authentication', {
    method: 'POST',
    headers: { ...from(), 'content-type': 'application/json', cookie: cookiesOf(options), ...headers },
    body: JSON.stringify({ response: device.authenticate(options.body) }),
  })
}

const passkeys = (h: Harness, userId: string) => h.deps.db.query<{ name: string | null; aaguid: string | null }>('select name, aaguid from passkey where "userId" = $1', [userId])

describe('passkeys (#287)', () => {
  it('registers a passkey after a code sign-in and signs in with it, without an email', async () => {
    const h = harness()
    const device = softAuthenticator('localhost', BASE_URL)
    const ana = await h.signIn('ana@example.com')
    expect((await register(h, ana, device)).status).toBe(200)
    const codes = h.codes.length
    h.clock.advance(3 * DAY)

    const signedIn = await authenticate(h, device, { 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' })
    expect(signedIn.status).toBe(200)
    expect(h.codes).toHaveLength(codes)
    const me = await h.request('/v1/me', { headers: { cookie: cookiesOf(signedIn) } })
    expect(me.status).toBe(200)
    expect(me.body.userId).toBe(ana.userId)

    // The session hooks ran as for a code: no device kept, and the sign-in dated (#166, #187).
    const sessions = await h.deps.db.query('select "ipAddress", "userAgent" from session where "userId" = $1', [ana.userId])
    expect(sessions).toEqual([
      { ipAddress: null, userAgent: null },
      { ipAddress: null, userAgent: null },
    ])
    const [user] = await h.deps.db.query<{ last_sign_in_at: Date }>('select last_sign_in_at from "user" where id = $1', [ana.userId])
    expect(user?.last_sign_in_at.getTime()).toBe(h.clock.now)
  })

  it('refuses to register without a session', async () => {
    const h = harness()
    expect((await h.request('/api/auth/passkey/generate-register-options', { headers: from() })).status).toBe(401)
    const verify = await h.request('/api/auth/passkey/verify-registration', {
      method: 'POST',
      headers: { ...from(), 'content-type': 'application/json' },
      body: JSON.stringify({ response: {} }),
    })
    expect(verify.status).toBe(401)
  })

  it('refuses to register with a session older than a day', async () => {
    const h = harness()
    const ana = await h.signIn()
    // Better Auth reads the real clock: age the session by two days in the database instead (src/auth.test.ts).
    await h.deps.db.query(`update session set "createdAt" = "createdAt" - interval '2 days' where "userId" = $1`, [ana.userId])
    const options = await h.request('/api/auth/passkey/generate-register-options', { headers: { ...from(), cookie: ana.cookie } })
    expect(options.status).toBe(403)
    expect(options.body.code).toBe('SESSION_NOT_FRESH')
    const verify = await h.request('/api/auth/passkey/verify-registration', {
      method: 'POST',
      headers: { ...from(), 'content-type': 'application/json', cookie: ana.cookie },
      body: JSON.stringify({ response: {} }),
    })
    expect(verify.status).toBe(403)
    expect(await passkeys(h, ana.userId)).toEqual([])
  })

  it('keeps no name and no model', async () => {
    const h = harness()
    const ana = await h.signIn()
    const reply = await register(h, ana, softAuthenticator('localhost', BASE_URL), { name: 'Ana phone' })
    expect(reply.status).toBe(200)
    expect(await passkeys(h, ana.userId)).toEqual([{ name: null, aaguid: null }])
  })

  it('has no rename', async () => {
    const h = harness()
    const ana = await h.signIn()
    await register(h, ana, softAuthenticator('localhost', BASE_URL))
    const [row] = await h.deps.db.query<{ id: string }>('select id from passkey where "userId" = $1', [ana.userId])
    expect((await ana.post('/api/auth/passkey/update-passkey', { id: row!.id, name: 'Ana phone' })).status).toBe(404)
    expect(await passkeys(h, ana.userId)).toEqual([{ name: null, aaguid: null }])
  })

  it("lists the learner's passkeys and deletes one; a deleted passkey no longer signs in", async () => {
    const h = harness()
    const ana = await h.signIn()
    const phone = softAuthenticator('localhost', BASE_URL)
    const laptop = softAuthenticator('localhost', BASE_URL)
    expect((await register(h, ana, phone)).status).toBe(200)
    expect((await register(h, ana, laptop)).status).toBe(200)
    // Another learner's passkey is not in Ana's list.
    await register(h, await h.signIn(), softAuthenticator('localhost', BASE_URL))

    const list = await ana.get('/api/auth/passkey/list-user-passkeys')
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(2)
    for (const key of list.body) expect(key).toMatchObject({ userId: ana.userId, name: null, aaguid: null })

    const [phoneKey] = await h.deps.db.query<{ id: string }>('select id from passkey where "credentialID" = $1', [phone.credentialIds[0]])
    const removed = await ana.post('/api/auth/passkey/delete-passkey', { id: phoneKey!.id })
    expect(removed.status).toBe(200)
    expect((await ana.get('/api/auth/passkey/list-user-passkeys')).body).toHaveLength(1)

    const gone = await authenticate(h, phone)
    expect(gone.status).toBe(401)
    expect(gone.body.code).toBe('PASSKEY_NOT_FOUND')
    expect(cookiesOf(gone)).not.toMatch(/session_token=/)
    expect((await authenticate(h, laptop)).status).toBe(200)
  })

  it("refuses another learner's passkey id on delete", async () => {
    const h = harness()
    const ana = await h.signIn()
    const bo = await h.signIn()
    await register(h, ana, softAuthenticator('localhost', BASE_URL))
    const [anaKey] = await h.deps.db.query<{ id: string }>('select id from passkey where "userId" = $1', [ana.userId])
    const reply = await bo.post('/api/auth/passkey/delete-passkey', { id: anaKey!.id })
    // The plugin answers 401 for a passkey that is someone else's.
    expect(reply.status).toBe(401)
    expect(await passkeys(h, ana.userId)).toHaveLength(1)
  })

  it('limits passkey sign-in attempts', async () => {
    const h = harness()
    const headers = from('198.51.100.31')
    const statuses: number[] = []
    for (let i = 0; i <= PASSKEY_SIGN_INS_PER_MINUTE; i += 1) statuses.push((await h.request('/api/auth/passkey/generate-authenticate-options', { headers })).status)
    expect(statuses).toEqual([...Array<number>(PASSKEY_SIGN_INS_PER_MINUTE).fill(200), 429])
    h.clock.advance(60_000)
    expect((await h.request('/api/auth/passkey/generate-authenticate-options', { headers })).status).toBe(200)
  })

  it('refuses a response from another origin', async () => {
    const h = harness()
    const ana = await h.signIn()
    const device = softAuthenticator('localhost', BASE_URL)
    const relayed = device.at('https://evil.example')
    // Better Auth logs each failed verification; the test needs none of it on its output.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    onTestFinished(() => errors.mockRestore())

    // Registering from another origin stores nothing. The plugin answers a failed verification with a 500.
    const refused = await register(h, ana, relayed)
    expect(refused.status).toBe(500)
    expect(refused.body.code).toBe('FAILED_TO_VERIFY_REGISTRATION')
    expect(await passkeys(h, ana.userId)).toEqual([])

    // A passkey registered here, its signature relayed from another origin, opens no session.
    expect((await register(h, ana, device)).status).toBe(200)
    const signIn = await authenticate(h, relayed)
    expect(signIn.status).toBe(400)
    expect(signIn.body.code).toBe('AUTHENTICATION_FAILED')
    expect(cookiesOf(signIn)).not.toMatch(/session_token=/)
    expect((await authenticate(h, device)).status).toBe(200)
  })
})

describe('the origins a passkey may come from', () => {
  it("are the app's and the trusted ones, each once", () => {
    const config = harness().deps.config
    expect(passkeyOrigins({ ...config, baseUrl: 'https://app.example.test/', trustedOrigins: ['https://app.example.test', 'http://localhost:5173/'] })).toEqual([
      'https://app.example.test',
      'http://localhost:5173',
    ])
  })
})
