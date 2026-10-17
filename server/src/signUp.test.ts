import { newsConsentText } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { BASE_URL, harness, type Harness } from '../test/harness'
import { createAuth, OTP_SECONDS } from './auth'
import { CREATE_ACCOUNT_PER_MINUTE, TICKET_SECONDS } from './signUp'

let ips = 0
/** Each call its own client address, so Better Auth's per-address limits answer only where a test means them to. */
const headers = (ip = `10.29.${++ips >> 8}.${ips & 255}`) => ({ 'content-type': 'application/json', origin: BASE_URL, 'cf-connecting-ip': ip })

async function sendCode(h: Harness, email: string): Promise<string> {
  const sent = await h.request('/api/auth/email-otp/send-verification-otp', { method: 'POST', headers: headers(), body: JSON.stringify({ email, type: 'sign-in' }) })
  expect(sent.status).toBe(200)
  await h.settle()
  return h.codes.filter((c) => c.email === email.toLowerCase()).at(-1)!.code
}

const checkCode = (h: Harness, email: string, otp: string, extra: Record<string, unknown> = {}) =>
  h.request('/api/auth/sign-in/email-otp', { method: 'POST', headers: headers(), body: JSON.stringify({ email, otp, ...extra }) })

const createAccount = (h: Harness, body: Record<string, unknown>, ip?: string) =>
  h.request('/api/auth/email-otp/create-account', { method: 'POST', headers: headers(ip), body: JSON.stringify(body) })

/** A right code for an address with no account: the ticket the sign-in answers with. */
async function ticketFor(h: Harness, email: string, extra: Record<string, unknown> = {}): Promise<string> {
  const reply = await checkCode(h, email, await sendCode(h, email), extra)
  expect(reply.status).toBe(202)
  return reply.body.ticket as string
}

const users = (h: Harness, email: string) => h.deps.db.query('select id from "user" where email = $1', [email])
const tickets = (h: Harness) => h.deps.db.query<{ identifier: string; value: string }>(`select identifier, value from verification where identifier like 'sign-up-ticket-%'`)
const cookieOf = (reply: { headers: Headers }) =>
  reply.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')

describe('email first, the age step only for a new account (#293)', () => {
  it('signs in an address with an account at once, with no ticket', async () => {
    const h = harness()
    const first = await h.signIn('ana@example.com')
    const reply = await checkCode(h, 'ana@example.com', await sendCode(h, 'ana@example.com'))
    expect(reply.status).toBe(200)
    expect(reply.body.user.id).toBe(first.userId)
    expect(cookieOf(reply)).toContain('session_token=')
    expect(await tickets(h)).toEqual([])
  })

  it('answers a right code for an address with no account with a ticket, and creates nothing', async () => {
    const h = harness()
    const reply = await checkCode(h, 'bo@example.com', await sendCode(h, 'bo@example.com'))
    expect(reply.status).toBe(202)
    expect(reply.body).toEqual({ code: 'NEW_ACCOUNT', message: expect.any(String), ticket: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) })
    expect(reply.headers.getSetCookie().filter((c) => c.includes('session_token='))).toEqual([])
    expect(await users(h, 'bo@example.com')).toEqual([])
    expect(await h.deps.db.query('select id from session')).toEqual([])
  })

  it('keeps the ticket only as a hash, beside the address, for no longer than a code lives', async () => {
    expect(TICKET_SECONDS).toBeLessThanOrEqual(OTP_SECONDS)
    const h = harness()
    const before = Date.now()
    const ticket = await ticketFor(h, 'bo@example.com')
    const rows = await h.deps.db.query<{ identifier: string; value: string; expiresAt: Date }>(
      `select identifier, value, "expiresAt" from verification where identifier like 'sign-up-ticket-%'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.value).toBe('bo@example.com')
    expect(rows[0]!.identifier).not.toContain(ticket)
    expect(JSON.stringify(await h.deps.db.query('select * from verification'))).not.toContain(ticket)
    expect(rows[0]!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + TICKET_SECONDS * 1000)
    expect(rows[0]!.expiresAt.getTime()).toBeGreaterThanOrEqual(before + TICKET_SECONDS * 1000 - 1000)
  })

  it('tells nothing about an address before its code is right: the same answers for one with an account and one without', async () => {
    const h = harness()
    await h.signIn('ana@example.com')
    const answers = async (email: string) => {
      const sent = await h.request('/api/auth/email-otp/send-verification-otp', { method: 'POST', headers: headers(), body: JSON.stringify({ email, type: 'sign-in' }) })
      await h.settle()
      const code = h.codes.filter((c) => c.email === email).at(-1)!.code
      const wrong = await checkCode(h, email, code === '000000' ? '111111' : '000000')
      const none = await checkCode(h, `nobody-${email}`, '123456')
      return [sent.status, sent.body, wrong.status, wrong.body, none.status, none.body]
    }
    expect(await answers('ana@example.com')).toEqual(await answers('bo@example.com'))
  })

  it('creates the account and signs in once the age is confirmed, with the ticket and no second code', async () => {
    const h = harness()
    const ticket = await ticketFor(h, 'bo@example.com')
    const codes = h.codes.length
    const reply = await createAccount(h, { email: 'bo@example.com', ticket, ageConfirmed: true })
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ token: expect.any(String), user: { id: expect.any(String), email: 'bo@example.com' } })
    expect(h.codes).toHaveLength(codes)
    const me = await h.request('/v1/me', { headers: { cookie: cookieOf(reply) } })
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({ userId: reply.body.user.id, email: 'bo@example.com' })
    expect(await tickets(h)).toEqual([])
  })

  it('serves a ticket once', async () => {
    const h = harness()
    const ticket = await ticketFor(h, 'bo@example.com')
    expect((await createAccount(h, { email: 'bo@example.com', ticket, ageConfirmed: true })).status).toBe(200)
    const again = await createAccount(h, { email: 'bo@example.com', ticket, ageConfirmed: true })
    expect(again.status).toBe(400)
    expect(again.body.code).toBe('INVALID_TICKET')
    expect(await users(h, 'bo@example.com')).toHaveLength(1)
  })

  it('turns away a learner below the age: no account, and the ticket is gone', async () => {
    const h = harness()
    const ticket = await ticketFor(h, 'bo@example.com')
    const refused = await createAccount(h, { email: 'bo@example.com', ticket, ageConfirmed: false })
    expect(refused.status).toBe(403)
    expect(refused.body.code).toBe('AGE_NOT_CONFIRMED')
    expect(refused.headers.getSetCookie().filter((c) => c.includes('session_token='))).toEqual([])
    expect(await users(h, 'bo@example.com')).toEqual([])
    expect(await tickets(h)).toEqual([])
    // Changing the answer afterwards needs a new code.
    expect((await createAccount(h, { email: 'bo@example.com', ticket, ageConfirmed: true })).status).toBe(400)
    expect(await users(h, 'bo@example.com')).toEqual([])
  })

  it('refuses a ticket for another address, and it is spent', async () => {
    const h = harness()
    const ticket = await ticketFor(h, 'bo@example.com')
    const other = await createAccount(h, { email: 'eve@example.com', ticket, ageConfirmed: true })
    expect(other.status).toBe(400)
    expect(other.body.code).toBe('INVALID_TICKET')
    expect(await users(h, 'eve@example.com')).toEqual([])
    expect((await createAccount(h, { email: 'bo@example.com', ticket, ageConfirmed: true })).status).toBe(400)
  })

  it('takes the address in any case, as the code did', async () => {
    const h = harness()
    const ticket = await ticketFor(h, 'Bo@Example.com')
    expect((await createAccount(h, { email: 'BO@example.COM', ticket, ageConfirmed: true })).status).toBe(200)
    expect(await users(h, 'bo@example.com')).toHaveLength(1)
  })

  it('refuses an expired ticket', async () => {
    const h = harness()
    const ticket = await ticketFor(h, 'bo@example.com')
    await h.deps.db.query(`update verification set "expiresAt" = now() - interval '1 second' where identifier like 'sign-up-ticket-%'`)
    const reply = await createAccount(h, { email: 'bo@example.com', ticket, ageConfirmed: true })
    expect(reply.status).toBe(400)
    expect(reply.body.code).toBe('INVALID_TICKET')
    expect(await users(h, 'bo@example.com')).toEqual([])
  })

  it('refuses a ticket it never issued, and a body without the age answer', async () => {
    const h = harness()
    const ticket = await ticketFor(h, 'bo@example.com')
    expect((await createAccount(h, { email: 'bo@example.com', ticket: 'x'.repeat(43), ageConfirmed: true })).body.code).toBe('INVALID_TICKET')
    for (const body of [{ email: 'bo@example.com', ticket }, { email: 'bo@example.com', ticket, ageConfirmed: 'yes' }, { ticket, ageConfirmed: true }]) {
      const reply = await createAccount(h, body)
      expect(reply.status).toBe(400)
      expect(reply.body.code).toBe('INVALID_BODY')
    }
    // A malformed body spends nothing: the ticket still makes the account.
    expect((await createAccount(h, { email: 'bo@example.com', ticket, ageConfirmed: true })).status).toBe(200)
  })

  it('signs in to an account another tab made meanwhile, rather than making a second', async () => {
    const h = harness()
    const first = await ticketFor(h, 'bo@example.com')
    const second = await ticketFor(h, 'bo@example.com')
    const a = await createAccount(h, { email: 'bo@example.com', ticket: first, ageConfirmed: true })
    const b = await createAccount(h, { email: 'bo@example.com', ticket: second, ageConfirmed: true })
    expect(b.status).toBe(200)
    expect(b.body.user.id).toBe(a.body.user.id)
    expect(await users(h, 'bo@example.com')).toHaveLength(1)
  })

  it('creates no account anywhere else: not through Better Auth’s own calls', async () => {
    const h = harness()
    const ctx = await createAuth(h.deps).$context
    await expect(ctx.internalAdapter.createUser({ email: 'mallory@example.com', emailVerified: true, name: '' }, { method: 'email-otp' })).rejects.toMatchObject({ body: { code: 'SIGN_UP_REFUSED' } })
    expect(await users(h, 'mallory@example.com')).toEqual([])
  })

  it(`limits account creation from one address to ${CREATE_ACCOUNT_PER_MINUTE} a minute`, async () => {
    const h = harness()
    const statuses: number[] = []
    for (let i = 0; i <= CREATE_ACCOUNT_PER_MINUTE; i += 1) statuses.push((await createAccount(h, { email: 'bo@example.com', ticket: `t${i}`, ageConfirmed: true }, '10.29.255.1')).status)
    expect(statuses).toEqual([...Array<number>(CREATE_ACCOUNT_PER_MINUTE).fill(400), 429])
  })
})

describe('consent to news with the new account (#186, #293)', () => {
  const BG = newsConsentText('bg')
  const consent = (h: Harness, email: string) => h.deps.db.query('select news_consent as consent, news_consent_text as text from "user" where email = $1', [email])

  it('records the ticked wording sent with the request that creates the account', async () => {
    const h = harness()
    const ticket = await ticketFor(h, 'bo@example.com')
    expect((await createAccount(h, { email: 'bo@example.com', ticket, ageConfirmed: true, newsConsent: BG })).status).toBe(200)
    expect(await consent(h, 'bo@example.com')).toEqual([{ consent: 'given', text: BG }])
  })

  it('records nothing without it, and nothing when the age was not confirmed', async () => {
    const h = harness()
    const ticket = await ticketFor(h, 'bo@example.com', { newsConsent: BG })
    expect((await createAccount(h, { email: 'bo@example.com', ticket, ageConfirmed: true })).status).toBe(200)
    expect(await consent(h, 'bo@example.com')).toEqual([{ consent: 'none', text: null }])
    const young = await ticketFor(h, 'cy@example.com')
    expect((await createAccount(h, { email: 'cy@example.com', ticket: young, ageConfirmed: false, newsConsent: BG })).status).toBe(403)
    expect(await consent(h, 'cy@example.com')).toEqual([])
  })
})
