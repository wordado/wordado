import { describe, expect, it, vi } from 'vitest'
import { BASE_URL, harness, type Harness } from '../test/harness'
import { runScheduled } from './jobs/scheduled'
import { CODE_SENDS_PER_ADDRESS_PER_HOUR, CODE_SENDS_PER_DAY, pruneSignInLimits, SIGN_IN_LIMIT_RETENTION_MS } from './signInLimit'

const HOUR = 3_600_000
const DAY = 86_400_000

let ips = 0

/** A code request from a new IP each time, so Better Auth's per-IP limit is never what answers. */
function sendCode(h: Harness, email: string) {
  ips += 1
  return h.request('/api/auth/email-otp/send-verification-otp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE_URL, 'cf-connecting-ip': `10.20.${ips >> 8}.${ips & 255}` },
    body: JSON.stringify({ email, type: 'sign-in' }),
  })
}

async function seedSends(h: Harness, count: number, sentAt: number): Promise<void> {
  await h.deps.db.query(
    `insert into sign_in_code_send (email, sent_at) select 'seed-' || n || '@example.com', $2 from generate_series(1, $1) as n`,
    [count, sentAt],
  )
}

describe('the sign-in email allowance (spec §17.2)', () => {
  it(`sends at most ${CODE_SENDS_PER_ADDRESS_PER_HOUR} codes an hour to one address, whatever the IP`, async () => {
    const h = harness()
    const statuses: number[] = []
    for (let i = 0; i <= CODE_SENDS_PER_ADDRESS_PER_HOUR; i += 1) statuses.push((await sendCode(h, 'Ana@Example.com')).status)
    expect(statuses).toEqual([200, 200, 200, 429])
    const refused = await sendCode(h, 'ana@example.com')
    expect(refused.status).toBe(429)
    expect(refused.body).toEqual({ error: 'sign_in_email_limit' })
    await h.settle()
    expect(h.codes).toHaveLength(CODE_SENDS_PER_ADDRESS_PER_HOUR)
    expect((await sendCode(h, 'bo@example.com')).status).toBe(200)
    h.clock.advance(HOUR)
    expect((await sendCode(h, 'ana@example.com')).status).toBe(200)
  })

  it(`sends at most ${CODE_SENDS_PER_DAY} codes in a UTC day in all`, async () => {
    const h = harness()
    const startOfDay = Math.floor(h.clock.now / DAY) * DAY
    await seedSends(h, CODE_SENDS_PER_DAY, startOfDay - 1)
    expect((await sendCode(h, 'ana@example.com')).status).toBe(200)
    await seedSends(h, CODE_SENDS_PER_DAY - 1, startOfDay)
    const refused = await sendCode(h, 'bo@example.com')
    expect(refused.status).toBe(429)
    expect(refused.body).toEqual({ error: 'sign_in_email_limit' })
    await h.settle()
    expect(h.codes.map((c) => c.email)).toEqual(['ana@example.com'])
    h.clock.now = startOfDay + DAY
    expect((await sendCode(h, 'bo@example.com')).status).toBe(200)
  })

  it('counts only the codes Better Auth sent', async () => {
    const h = harness()
    expect((await sendCode(h, 'not an address')).status).toBe(400)
    expect(await h.deps.db.query('select email from sign_in_code_send')).toEqual([])
    expect((await sendCode(h, 'ana@example.com')).status).toBe(200)
    expect(await h.deps.db.query('select email from sign_in_code_send')).toEqual([{ email: 'ana@example.com' }])
  })

  it('logs a code the mailer failed to send instead of losing the failure', async () => {
    const h = harness()
    vi.spyOn(h.deps.mailer, 'sendSignInCode').mockRejectedValueOnce(new Error('Resend refused the email: 500'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect((await sendCode(h, 'ana@example.com')).status).toBe(200)
      await h.settle()
      expect(logged).toHaveBeenCalledWith('sign-in code not sent', expect.any(Error))
    } finally {
      logged.mockRestore()
    }
  })
})

describe('pruning the sign-in limits', () => {
  it("drops code sends and Better Auth's rate-limit rows a day old, from the cron", async () => {
    const h = harness()
    await seedSends(h, 2, h.clock.now - SIGN_IN_LIMIT_RETENTION_MS - 1)
    await seedSends(h, 1, h.clock.now - SIGN_IN_LIMIT_RETENTION_MS + 1)
    await h.deps.db.query(
      `insert into "rateLimit" (id, key, count, "lastRequest") values ('old', 'k-old', 1, $1), ('new', 'k-new', 1, $2)`,
      [h.clock.now - SIGN_IN_LIMIT_RETENTION_MS - 1, h.clock.now - HOUR],
    )
    expect(await pruneSignInLimits(h.deps)).toEqual({ codeSends: 2, rateLimits: 1 })
    await seedSends(h, 1, h.clock.now - 2 * DAY)
    await runScheduled(h.deps)
    expect(await h.deps.db.query('select count(*)::int as n from sign_in_code_send')).toEqual([{ n: 1 }])
    expect(await h.deps.db.query(`select key from "rateLimit"`)).toEqual([{ key: 'k-new' }])
  })
})
