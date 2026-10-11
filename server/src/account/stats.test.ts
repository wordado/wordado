import { describe, expect, it, vi } from 'vitest'
import { pushPage, rawEvent } from '../../test/events'
import { harness, type Harness, type Reply } from '../../test/harness'
import { accountStats, type AccountStats } from './stats'

const DAY = 86_400_000
const MINUTE = 60_000
const token = 'w'.repeat(40)
const withToken = () => harness({ config: { adminWriteToken: token } })
const read = (h: Harness): Promise<Reply> => h.request('/v1/admin/accounts/stats', { headers: { authorization: `Bearer ${token}` } })

const none = (readAt: number): AccountStats => ({ readAt, accounts: 0, made7: 0, made30: 0, studied7: 0, studied30: 0, newsGiven: 0, newsWithdrawn: 0, newsNone: 0, reminders: 0 })

let made = 0

/** An account written directly, made `ago` milliseconds before the harness's clock. */
async function account(h: Harness, ago: number): Promise<string> {
  made += 1
  const id = `counted-${made}`
  await h.deps.db.query(`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, '', $2, true, $3, $3)`, [id, `${id}@example.com`, new Date(h.clock.now - ago)])
  return id
}

/** A device of an account whose last answer was `ago` milliseconds before the harness's clock. */
const device = (h: Harness, userId: string, deviceId: string, ago: number) =>
  h.deps.db.query('insert into device (user_id, device_id, device_seq, effective_ts) values ($1, $2, 1, $3)', [userId, deviceId, h.clock.now - ago])

const subscription = (h: Harness, userId: string, endpoint: string) =>
  h.deps.db.query(
    `insert into push_subscription (endpoint, user_id, p256dh, auth, reminder_minute, tz_offset_min, language, created_at) values ($1, $2, 'key', 'auth', 540, 180, 'bg', $3)`,
    [`https://push.example.com/${endpoint}`, userId, h.clock.now],
  )

describe('the counts of accounts and their use (#206)', () => {
  it('are all nothing in an empty database', async () => {
    const h = withToken()
    const reply = await read(h)
    expect(reply.status).toBe(200)
    expect(reply.headers.get('cache-control')).toBe('no-store')
    expect(reply.body).toEqual(none(h.clock.now))
  })

  it('count the accounts made in the last 7 and 30 days, the edge within', async () => {
    const h = withToken()
    for (const ago of [0, 7 * DAY, 7 * DAY + 1, 30 * DAY, 30 * DAY + 1, 400 * DAY]) await account(h, ago)
    expect(await accountStats(h.deps)).toEqual({ ...none(h.clock.now), accounts: 6, made7: 2, made30: 4, newsNone: 6 })
    // A millisecond on, the two on the edges are past it.
    h.clock.advance(1)
    expect(await accountStats(h.deps)).toMatchObject({ accounts: 6, made7: 1, made30: 3 })
  })

  it('count the accounts that studied in the last 7 and 30 days, the edge within and each account once', async () => {
    const h = withToken()
    const [now, week, pastWeek, month, pastMonth, never, both] = await Promise.all([0, 0, 0, 0, 0, 0, 0].map(() => account(h, 400 * DAY)))
    await device(h, now!, 'a', 0)
    await device(h, week!, 'a', 7 * DAY)
    await device(h, pastWeek!, 'a', 7 * DAY + 1)
    await device(h, month!, 'a', 30 * DAY)
    await device(h, pastMonth!, 'a', 30 * DAY + 1)
    // Two devices in the week and one long put away: one account all the same.
    await device(h, both!, 'a', DAY)
    await device(h, both!, 'b', 2 * DAY)
    await device(h, both!, 'c', 300 * DAY)
    expect(never).toBeTruthy()
    expect(await accountStats(h.deps)).toMatchObject({ accounts: 7, studied7: 3, studied30: 5 })
    h.clock.advance(1)
    expect(await accountStats(h.deps)).toMatchObject({ accounts: 7, studied7: 2, studied30: 4 })
  })

  it('count an answer from when the server took it to have been given, as a push records it', async () => {
    const h = withToken()
    const studying = await h.signIn('ana@example.com')
    await h.signIn('ben@example.com')
    expect(await accountStats(h.deps)).toMatchObject({ accounts: 2, made7: 2, studied7: 0, studied30: 0 })
    const push = await studying.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [rawEvent('dev-a', 1, h.clock.now - MINUTE)]))
    expect(push.body.rejected).toEqual([])
    expect(await accountStats(h.deps)).toMatchObject({ accounts: 2, studied7: 1, studied30: 1 })
    // Days on with nothing more: out of the week, then out of the month.
    h.clock.advance(8 * DAY)
    expect(await accountStats(h.deps)).toMatchObject({ studied7: 0, studied30: 1 })
    h.clock.advance(23 * DAY)
    expect(await accountStats(h.deps)).toMatchObject({ accounts: 2, made7: 0, made30: 0, studied7: 0, studied30: 0 })
  })

  it('count the accounts by what they said to news, and those with reminders on once each', async () => {
    const h = withToken()
    const [given, withdrawn, silent, other] = await Promise.all([0, 0, 0, 0].map(() => account(h, 400 * DAY)))
    await h.deps.db.query(`update "user" set news_consent = 'given', news_consent_at = now(), news_consent_text = 'v1 en' where id = any($1::text[])`, [[given, other]])
    await h.deps.db.query(`update "user" set news_consent = 'withdrawn', news_consent_at = now(), news_consent_text = 'v1 en' where id = $1`, [withdrawn])
    await subscription(h, given!, 'phone')
    await subscription(h, given!, 'laptop')
    await subscription(h, silent!, 'phone-2')
    expect(await accountStats(h.deps)).toEqual({ ...none(h.clock.now), accounts: 4, newsGiven: 2, newsWithdrawn: 1, newsNone: 1, reminders: 2 })
  })

  it('answer numbers only, and log nothing', async () => {
    const h = withToken()
    const s = await h.signIn('ana@example.com')
    await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [rawEvent('dev-a', 1, h.clock.now - MINUTE)]))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const reply = await read(h)
      expect(Object.keys(reply.body).sort()).toEqual(Object.keys(none(0)).sort())
      for (const value of Object.values(reply.body)) expect(Number.isSafeInteger(value)).toBe(true)
      expect(JSON.stringify(reply.body)).not.toContain(s.userId)
      expect(JSON.stringify(reply.body)).not.toContain('ana')
      expect(log.mock.calls).toEqual([])
    } finally {
      log.mockRestore()
    }
  })

  it('are a route that does not exist without the token', async () => {
    const h = withToken()
    const unknown = await h.request('/v1/no-such-route')
    for (const authorization of ['', `Bearer ${token}x`]) {
      const reply = await h.request('/v1/admin/accounts/stats', { headers: { authorization } })
      expect(reply.status).toBe(404)
      expect(reply.body).toEqual(unknown.body)
    }
    expect((await h.request('/v1/admin/accounts/stats', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' })).status).toBe(404)
  })
})
