import { describe, expect, it, vi } from 'vitest'
import { BASE_URL, harness, type Harness, type Reply } from '../../test/harness'
import { hasBearerToken } from '../adminToken'
import { ACCOUNT_SWEEP_BATCH, INACTIVE_ACCOUNT_MONTHS, INACTIVE_ACCOUNT_MS } from './sweep'

const DAY = 86_400_000
const token = 'w'.repeat(40)
const readToken = 'r'.repeat(40)
const withToken = () => harness({ config: { adminWriteToken: token, feedbackReadToken: readToken } })

/** As the review app's server asks: the token, a JSON body, and no Origin or cookie. */
const ask = (h: Harness, path: string, body?: unknown, authorization: string | null = `Bearer ${token}`): Promise<Reply> =>
  h.request(`/v1/admin/accounts/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(authorization === null ? {} : { authorization }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const users = async (h: Harness): Promise<string[]> => (await h.deps.db.query<{ email: string }>('select email from "user" order by email')).map((r) => r.email)

/** What the lookup says of an account that was only ever signed in to. */
const unused = { lastStudiedAt: null, daysStudied30: 0, newsConsent: 'none', newsConsentAt: null, newsConsentLanguage: null, reminders: [], devices: 0 }

describe('the accounts routes of the review app (#187)', () => {
  it('looks an account up by its address: when it was made and last signed in, how it is used, and nothing else', async () => {
    const h = withToken()
    const s = await h.signIn('ana@example.com')
    const reply = await ask(h, 'lookup', { email: 'ana@example.com' })
    expect(reply.status).toBe(200)
    expect(reply.headers.get('cache-control')).toBe('no-store')
    expect(reply.body).toEqual({ found: true, createdAt: expect.any(Number), lastSignInAt: h.clock.now, details: { ...unused, sweepNotBefore: h.clock.now + INACTIVE_ACCOUNT_MS } })
    expect(JSON.stringify(reply.body)).not.toContain(s.userId)
    // As a person writes it: spaces round it, capitals in it.
    expect((await ask(h, 'lookup', { email: '  Ana@Example.com ' })).body).toMatchObject({ found: true })
    expect((await ask(h, 'lookup', { email: 'nobody@example.com' })).body).toEqual({ found: false })
    // The whole address, never a part or a pattern of it.
    for (const email of ['ana@example', 'ana', '%@example.com', 'ana@example.com%', '_na@example.com']) expect((await ask(h, 'lookup', { email })).body).not.toMatchObject({ found: true })
  })

  it('gives an account with no date as one with none', async () => {
    const h = withToken()
    await h.deps.db.query(`insert into "user" (id, name, email, "emailVerified", "updatedAt") values ('u1', '', 'old@example.com', true, now())`)
    // The sweep never takes it, so there is no moment it could.
    expect((await ask(h, 'lookup', { email: 'old@example.com' })).body).toEqual({ found: true, createdAt: expect.any(Number), lastSignInAt: null, details: { ...unused, sweepNotBefore: null } })
  })

  it('says how the account is used: its study, its consent to news, its reminders and its devices (#209)', async () => {
    const h = withToken()
    h.clock.now = Date.parse('2026-10-14T10:00:00Z')
    const today = Date.parse('2026-10-14T00:00:00Z')
    const s = await h.signIn('ana@example.com')
    const other = await h.signIn('ben@example.com')
    const answer = (userId: string, n: number, ts: number, deviceId: string) =>
      h.deps.db.query(
        `insert into review_event (user_id, review_id, word_id, mode, direction, grade, latency_ms, practice, client_ts, client_tz_offset_min, device_id, device_seq,
           scheduler_version, received_at, effective_ts, xp_eligible, client_local_day, local_day, utc_day)
         values ($1, $2, 'c:hello-1', 'multiple_choice', 'en_to_l1', 3, 1500, false, $3, 0, $4, $5, 'v', $3, $3, true, $6, $6, $6)`,
        [userId, `answer-${n}`, ts, deviceId, n, Math.floor(ts / DAY)],
      )
    // Twice today, once on the first of the 30 days, once the day before it; and somebody else's answers, which are not its.
    const studied = [today + 60_000, today + 120_000, today - 29 * DAY, today - 29 * DAY - 1]
    for (const [n, ts] of studied.entries()) await answer(s.userId, n, ts, n === 0 ? 'phone' : 'laptop')
    await answer(other.userId, 9, today - DAY, 'phone')
    await h.deps.db.query(`insert into device (user_id, device_id, device_seq, effective_ts) values ($1, 'phone', 1, $2), ($1, 'laptop', 3, $3), ($4, 'phone', 1, $2)`, [s.userId, today + 60_000, today + 120_000, other.userId])
    const agreed = Date.parse('2026-09-03T08:00:00Z')
    await h.deps.db.query(`update "user" set news_consent = 'withdrawn', news_consent_at = $2, news_consent_text = 'news-1.bg' where id = $1`, [s.userId, new Date(agreed)])
    // Two devices with reminders, the newer first; the older was ignored until the app stopped sending.
    await h.deps.db.query(
      `insert into push_subscription (endpoint, user_id, p256dh, auth, reminder_minute, tz_offset_min, language, ignored, created_at) values
         ('https://push.example.com/old', $1, 'key', 'auth', 540, 180, 'bg', 3, 1), ('https://push.example.com/new', $1, 'key', 'auth', 1170, -300, 'bg', 2, 2),
         ('https://push.example.com/other', $2, 'key', 'auth', 600, 0, 'en', 0, 3)`,
      [s.userId, other.userId],
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const reply = await ask(h, 'lookup', { email: 'ana@example.com' })
      expect(reply.body.details).toEqual({
        lastStudiedAt: today + 120_000,
        daysStudied30: 2,
        newsConsent: 'withdrawn',
        newsConsentAt: agreed,
        newsConsentLanguage: 'bg',
        reminders: [{ minute: 1170, tzOffsetMin: -300, paused: false }, { minute: 540, tzOffsetMin: 180, paused: true }],
        devices: 2,
        sweepNotBefore: h.clock.now + INACTIVE_ACCOUNT_MS,
      })
      // Nothing that names the account or a device, and nothing in the log.
      for (const secret of [s.userId, 'phone', 'laptop', 'push.example.com', 'news-1']) expect(JSON.stringify(reply.body)).not.toContain(secret)
      expect(log.mock.calls).toEqual([])
    } finally {
      log.mockRestore()
    }
    // The 30 days move with the clock: a day on, the first of them is out.
    h.clock.advance(DAY)
    expect((await ask(h, 'lookup', { email: 'ana@example.com' })).body.details).toMatchObject({ daysStudied30: 1 })
  })

  it('deletes by address as the learner’s own deletion does, and only when the request confirms it', async () => {
    const h = withToken()
    const leaving = await h.signIn('ana@example.com')
    const staying = await h.signIn('ben@example.com')
    for (const s of [leaving, staying]) {
      await s.post('/v1/feedback', { kind: 'idea', message: 'A dark theme, please.', email: s.email, appVersion: 'v', corpusVersion: 'bg 6', language: 'bg', screen: '/', userAgent: 'ua' })
      await h.deps.db.query(
        `insert into content_report (reporter_id, report_key, word_id, field, note, pack_version, created_at, received_at) values ($1, 'rep-1', 'c:w-1', 'translation', 'robotic', 0, 1, 1)`,
        [s.userId],
      )
    }
    for (const body of [{ email: 'ana@example.com' }, { email: 'ana@example.com', confirm: 'yes' }, { email: 'ana@example.com', confirm: false }, { confirm: true }, { email: 7, confirm: true }]) {
      expect((await ask(h, 'delete', body)).status).toBe(400)
    }
    expect(await users(h)).toEqual(['ana@example.com', 'ben@example.com'])
    const reply = await ask(h, 'delete', { email: ' Ana@example.com', confirm: true })
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ deleted: true })
    expect(await users(h)).toEqual(['ben@example.com'])
    expect((await leaving.get('/v1/me')).status).toBe(401)
    expect((await staying.get('/v1/me')).status).toBe(200)
    expect(await h.deps.db.query('select distinct "userId" from "session"')).toEqual([{ userId: staying.userId }])
    expect(await h.deps.db.query('select reporter_id from content_report order by reporter_id nulls first')).toEqual([{ reporter_id: null }, { reporter_id: staying.userId }])
    expect(await h.deps.db.query('select contact_email from feedback order by contact_email')).toEqual([{ contact_email: '' }, { contact_email: 'ben@example.com' }])
    expect(await h.deps.db.query('select email from sign_in_code_send')).toEqual([{ email: 'ben@example.com' }])
    // Asked again, there is nothing to delete, and it says so.
    expect((await ask(h, 'delete', { email: 'ana@example.com', confirm: true })).body).toEqual({ deleted: false })
    expect((await ask(h, 'lookup', { email: 'ana@example.com' })).body).toEqual({ found: false })
  })

  it('refuses an address two accounts answer to, since it cannot know which is meant', async () => {
    const h = withToken()
    await h.deps.db.query(
      `insert into "user" (id, name, email, "emailVerified", "updatedAt") values ('u1', '', 'Ana@example.com', true, now()), ('u2', '', 'ana@example.com', true, now())`,
    )
    expect((await ask(h, 'lookup', { email: 'ana@example.com' })).status).toBe(409)
    expect((await ask(h, 'delete', { email: 'ana@example.com', confirm: true })).status).toBe(409)
    expect(await users(h)).toHaveLength(2)
  })

  it('counts what the sweep would take and what it took', async () => {
    const h = withToken()
    await h.signIn()
    await h.deps.db.query(
      `insert into "user" (id, name, email, "emailVerified", "updatedAt", last_sign_in_at) values ('u1', '', 'old@example.com', true, now(), $1), ('u2', '', 'new@example.com', true, now(), null)`,
      [new Date(h.clock.now - INACTIVE_ACCOUNT_MS - DAY)],
    )
    const reply = await ask(h, 'sweep')
    expect(reply.status).toBe(200)
    expect(reply.headers.get('cache-control')).toBe('no-store')
    expect(reply.body).toEqual({ months: INACTIVE_ACCOUNT_MONTHS, batch: ACCOUNT_SWEEP_BATCH, due: 1, undated: 1, taken: 0, lastRunAt: null, lastTaken: 0 })
  })

  it('is a route that does not exist without the token, with the token that reads feedback, or when the secret is not set', async () => {
    const h = withToken()
    await h.signIn('ana@example.com')
    const unknown = await h.request('/v1/no-such-route')
    const tries: [string, unknown?][] = [['lookup', { email: 'ana@example.com' }], ['delete', { email: 'ana@example.com', confirm: true }], ['sweep'], ['stats'], ['series'], ['splits']]
    for (const authorization of [null, '', 'Bearer ', `Bearer ${readToken}`, `Bearer ${token}x`, `bearer ${token}`, `Basic ${token}`, token]) {
      for (const [path, body] of tries) {
        const reply = await ask(h, path, body, authorization)
        expect(reply.status).toBe(404)
        expect(reply.body).toEqual(unknown.body)
      }
    }
    // The token that deletes does not read feedback either: each opens its own routes.
    expect((await h.request('/v1/admin/feedback', { headers: { authorization: `Bearer ${token}` } })).status).toBe(404)
    // A signed-in learner is nobody here.
    const s = await h.signIn()
    expect((await s.post('/v1/admin/accounts/delete', { email: 'ana@example.com', confirm: true })).status).toBe(404)
    // With no secret of its own the routes are closed, whatever else is set.
    const closed = harness({ config: { feedbackReadToken: readToken } })
    for (const authorization of [null, `Bearer ${token}`, `Bearer ${readToken}`, 'Bearer null']) {
      for (const [path, body] of tries) expect((await ask(closed, path, body, authorization)).status).toBe(404)
    }
    expect(await users(h)).toContain('ana@example.com')
  })

  it('takes a JSON body from a server and nothing a page of another site can send', async () => {
    const h = withToken()
    await h.signIn('ana@example.com')
    const form = await h.request('/v1/admin/accounts/delete', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain', origin: 'https://elsewhere.example.com' },
      body: JSON.stringify({ email: 'ana@example.com', confirm: true }),
    })
    expect(form.status).toBe(403)
    // Nor one that is not JSON, wherever it comes from.
    const broken = await h.request('/v1/admin/accounts/delete', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: 'email=ana@example.com&confirm=true' })
    expect(broken.status).toBe(400)
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const reply = await h.request('/v1/admin/accounts/delete', { method, headers: { authorization: `Bearer ${token}`, origin: BASE_URL } })
      expect(reply.status).toBe(404)
    }
    expect(await users(h)).toEqual(['ana@example.com'])
  })

  it('logs that an account was deleted, and never which', async () => {
    const h = withToken()
    const s = await h.signIn('ana@example.com')
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await ask(h, 'delete', { email: 'ana@example.com', confirm: true })
      await ask(h, 'lookup', { email: 'ana@example.com' })
      expect(log.mock.calls).toEqual([['admin: 1 account deleted']])
      expect(JSON.stringify(log.mock.calls)).not.toContain(s.userId)
    } finally {
      log.mockRestore()
    }
  })

  it('compares the whole token', async () => {
    expect(await hasBearerToken(token, `Bearer ${token}`)).toBe(true)
    expect(await hasBearerToken(token, `Bearer ${token.slice(0, -1)}`)).toBe(false)
    expect(await hasBearerToken(token, `Bearer ${token}${token}`)).toBe(false)
    expect(await hasBearerToken(token, undefined)).toBe(false)
  })
})
