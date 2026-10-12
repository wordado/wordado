import { describe, expect, it, vi } from 'vitest'
import { pushPage, rawEvent } from '../../test/events'
import { harness, type Harness, type Reply } from '../../test/harness'
import { accountSeries, accountSplits, accountStats, SERIES_DAYS, SERIES_WEEKS, type AccountStats } from './stats'

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

/** A Wednesday, 10:00 UTC: its week began on Monday the 12th. */
const WEDNESDAY = Date.parse('2026-10-14T10:00:00Z')
const MONDAY = Date.parse('2026-10-12T00:00:00Z')
const TODAY = Date.parse('2026-10-14T00:00:00Z')
const WEEK = 7 * DAY

const at = (now: number): Harness => {
  const h = withToken()
  h.clock.now = now
  return h
}
const ask = (h: Harness, what: 'series' | 'splits'): Promise<Reply> => h.request(`/v1/admin/accounts/${what}`, { headers: { authorization: `Bearer ${token}` } })

let answers = 0

/** An answer written directly, given at `ts` as the server stamped it. */
async function answer(h: Harness, userId: string, ts: number, deviceId = 'a'): Promise<void> {
  answers += 1
  const day = Math.floor(ts / DAY)
  await h.deps.db.query(
    `insert into review_event (user_id, review_id, word_id, mode, direction, grade, latency_ms, practice, client_ts, client_tz_offset_min, device_id, device_seq,
       scheduler_version, received_at, effective_ts, xp_eligible, client_local_day, local_day, utc_day)
     values ($1, $2, 'c:hello-1', 'multiple_choice', 'en_to_l1', 3, 1500, false, $3, 0, $4, $5, 'v', $3, $3, true, $6, $6, $6)`,
    [userId, `answer-${answers}`, ts, deviceId, answers, day],
  )
}

describe('the accounts by week made and by day studied (#209)', () => {
  it('are all nothing in an empty database, as long as the widest period', async () => {
    const h = at(WEDNESDAY)
    const reply = await ask(h, 'series')
    expect(reply.status).toBe(200)
    expect(reply.headers.get('cache-control')).toBe('no-store')
    expect(reply.body).toEqual({ readAt: WEDNESDAY, accounts: 0, weekStart: MONDAY, madeByWeek: Array.from({ length: SERIES_WEEKS }, () => 0), dayStart: TODAY, studiedByDay: Array.from({ length: SERIES_DAYS }, () => 0) })
  })

  it('put an account in the UTC week it was made in, Monday first, and one from before the first week only in the total', async () => {
    const h = at(WEDNESDAY)
    const first = MONDAY - (SERIES_WEEKS - 1) * WEEK
    // This week: now, and its first millisecond. Last week: its last millisecond, and its first. The first week's first, and the one before it.
    for (const made of [WEDNESDAY, MONDAY, MONDAY - 1, MONDAY - WEEK, first, first - 1, WEDNESDAY - 400 * DAY]) await account(h, WEDNESDAY - made)
    const series = await accountSeries(h.deps)
    expect(series.accounts).toBe(7)
    expect(series.weekStart).toBe(MONDAY)
    expect(series.madeByWeek).toEqual([1, ...Array.from({ length: SERIES_WEEKS - 3 }, () => 0), 2, 2])
    // On Sunday night the week is still that one; a millisecond on, a new week begins with nothing in it.
    h.clock.now = MONDAY + WEEK - 1
    expect((await accountSeries(h.deps)).madeByWeek.slice(-2)).toEqual([2, 2])
    h.clock.now = MONDAY + WEEK
    const next = await accountSeries(h.deps)
    expect(next.weekStart).toBe(MONDAY + WEEK)
    expect(next.madeByWeek).toEqual([...Array.from({ length: SERIES_WEEKS - 3 }, () => 0), 2, 2, 0])
    expect(next.accounts).toBe(7)
  })

  it('count an account on each UTC day it gave an answer, once whatever it gave and from however many devices', async () => {
    const h = at(WEDNESDAY)
    const [ana, ben, idle] = await Promise.all([0, 0, 0].map(() => account(h, 400 * DAY)))
    const first = TODAY - (SERIES_DAYS - 1) * DAY
    // Today: both, one of them three times and from two devices. Yesterday: its last millisecond.
    await answer(h, ana!, TODAY)
    await answer(h, ana!, WEDNESDAY - MINUTE)
    await answer(h, ana!, WEDNESDAY - MINUTE, 'b')
    await answer(h, ben!, TODAY + MINUTE)
    await answer(h, ben!, TODAY - 1)
    // The first day's first millisecond, and the one before it, which is of no day shown.
    await answer(h, ana!, first)
    await answer(h, ben!, first - 1)
    expect(idle).toBeTruthy()
    const series = await accountSeries(h.deps)
    expect(series.dayStart).toBe(TODAY)
    expect(series.studiedByDay).toEqual([1, ...Array.from({ length: SERIES_DAYS - 3 }, () => 0), 1, 2])
    // A day on, every day has moved one back and the oldest is gone.
    h.clock.advance(DAY)
    expect((await accountSeries(h.deps)).studiedByDay).toEqual([...Array.from({ length: SERIES_DAYS - 3 }, () => 0), 1, 2, 0])
  })

  it('count an answer on the day the server took it to have been given, as a push records it', async () => {
    // By the real clock: an account signed up for is dated by the database's.
    const h = withToken()
    const studying = await h.signIn('ana@example.com')
    await h.signIn('ben@example.com')
    const push = await studying.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [rawEvent('dev-a', 1, h.clock.now - MINUTE)]))
    expect(push.body.rejected).toEqual([])
    const series = await accountSeries(h.deps)
    expect(series.studiedByDay.at(-1)).toBe(1)
    expect(series.studiedByDay.slice(0, -1).every((n) => n === 0)).toBe(true)
    expect(series.madeByWeek.at(-1)).toBe(2)
  })

  it('answer numbers only, and log nothing', async () => {
    const h = at(WEDNESDAY)
    const s = await h.signIn('ana@example.com')
    await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [rawEvent('dev-a', 1, h.clock.now - MINUTE)]))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      for (const what of ['series', 'splits'] as const) {
        const reply = await ask(h, what)
        expect(JSON.stringify(reply.body)).not.toContain(s.userId)
        expect(JSON.stringify(reply.body)).not.toContain('ana')
      }
      const series = (await ask(h, 'series')).body
      expect(Object.keys(series).sort()).toEqual(['accounts', 'dayStart', 'madeByWeek', 'readAt', 'studiedByDay', 'weekStart'])
      for (const n of [series.readAt, series.accounts, series.weekStart, series.dayStart, ...series.madeByWeek, ...series.studiedByDay]) expect(Number.isSafeInteger(n)).toBe(true)
      expect(log.mock.calls).toEqual([])
    } finally {
      log.mockRestore()
    }
  })

  it('are routes that do not exist without the token', async () => {
    const h = withToken()
    const unknown = await h.request('/v1/no-such-route')
    for (const what of ['series', 'splits']) {
      for (const authorization of ['', `Bearer ${token}x`]) {
        const reply = await h.request(`/v1/admin/accounts/${what}`, { headers: { authorization } })
        expect(reply.status).toBe(404)
        expect(reply.body).toEqual(unknown.body)
      }
      expect((await h.request(`/v1/admin/accounts/${what}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' })).status).toBe(404)
    }
  })
})

describe('the accounts by language (#209)', () => {
  const consent = (h: Harness, userId: string, state: 'given' | 'withdrawn', text: string) =>
    h.deps.db.query(`update "user" set news_consent = $2, news_consent_at = now(), news_consent_text = $3 where id = $1`, [userId, state, text])
  const reminder = (h: Harness, userId: string, endpoint: string, language: string, ignored: number, ago = 0) =>
    h.deps.db.query(
      `insert into push_subscription (endpoint, user_id, p256dh, auth, reminder_minute, tz_offset_min, language, ignored, created_at) values ($1, $2, 'key', 'auth', 540, 180, $3, $4, $5)`,
      [`https://push.example.com/${endpoint}`, userId, language, ignored, h.clock.now - ago],
    )
  const l1 = (h: Harness, userId: string, language: string) =>
    h.deps.db.query(`insert into document (user_id, type, key, class, version, fields, field_versions) values ($1, 'settings', '', 'versioned', 1, $2, '{}')`, [userId, JSON.stringify({ l1: language })])

  it('are no rows in an empty database', async () => {
    const h = withToken()
    const reply = await ask(h, 'splits')
    expect(reply.status).toBe(200)
    expect(reply.headers.get('cache-control')).toBe('no-store')
    expect(reply.body).toEqual({ readAt: h.clock.now, news: [], reminders: [] })
  })

  it('split news by the language an announcement would be written in, and count an account with no sign of one as not known', async () => {
    const h = withToken()
    const [agreedBg, withdrewBg, silentBg, agreedDe, byReminder, silent, odd] = await Promise.all([0, 0, 0, 0, 0, 0, 0].map(() => account(h, 400 * DAY)))
    await consent(h, agreedBg!, 'given', 'news-1.bg')
    await consent(h, withdrewBg!, 'withdrawn', 'news-1.bg')
    // Said nothing, but its settings name its language.
    await l1(h, silentBg!, 'bg')
    await consent(h, agreedDe!, 'given', 'news-1.de')
    // Agreed in German, and its newest device asks its reminders in Spanish: Spanish it is.
    await consent(h, byReminder!, 'given', 'news-1.de')
    await reminder(h, byReminder!, 'old', 'de', 0, DAY)
    await reminder(h, byReminder!, 'new', 'es', 0)
    // No sign of a language, and a wording that names one this version does not know.
    expect(silent).toBeTruthy()
    await consent(h, odd!, 'given', 'news-1.xx')
    const { news } = await accountSplits(h.deps)
    expect(news).toEqual([
      { language: 'bg', given: 1, withdrawn: 1, none: 1 },
      { language: 'de', given: 1, withdrawn: 0, none: 0 },
      { language: 'es', given: 1, withdrawn: 0, none: 0 },
      { language: null, given: 1, withdrawn: 0, none: 1 },
    ])
    // Together they are the accounts there are, as the tiles count them.
    const stats = await accountStats(h.deps)
    expect(news.reduce((sum, row) => sum + row.given, 0)).toBe(stats.newsGiven)
    expect(news.reduce((sum, row) => sum + row.withdrawn, 0)).toBe(stats.newsWithdrawn)
    expect(news.reduce((sum, row) => sum + row.none, 0)).toBe(stats.newsNone)
  })

  it('split news by the language the account’s app said, before the older signs of one (#199)', async () => {
    const h = withToken()
    const [said, silent, saidOnly] = await Promise.all([0, 0, 0].map(() => account(h, 400 * DAY)))
    for (const id of [said, silent]) {
      await consent(h, id!, 'given', 'news-1.de')
      await reminder(h, id!, `device-${id}`, 'es', 0)
      await l1(h, id!, 'bg')
    }
    await h.deps.db.query(`update "user" set interface_language = 'en' where id = $1`, [said])
    await h.deps.db.query(`update "user" set interface_language = 'bg' where id = $1`, [saidOnly])
    expect((await accountSplits(h.deps)).news).toEqual([
      { language: 'bg', given: 0, withdrawn: 0, none: 1 },
      { language: 'en', given: 1, withdrawn: 0, none: 0 },
      { language: 'es', given: 1, withdrawn: 0, none: 0 },
    ])
  })

  it('split reminders by the language of the newest device, each account once: paused only when every device is', async () => {
    const h = withToken()
    const [sending, paused, mixed, off] = await Promise.all([0, 0, 0, 0].map(() => account(h, 400 * DAY)))
    await reminder(h, sending!, 'a', 'bg', 2)
    // Ignored three times in a row: the app sends no more.
    await reminder(h, paused!, 'b', 'bg', 3)
    // One device paused, a newer one not: sending, in the newer one's language.
    await reminder(h, mixed!, 'c', 'bg', 5, DAY)
    await reminder(h, mixed!, 'd', 'en', 0)
    expect(off).toBeTruthy()
    const { reminders } = await accountSplits(h.deps)
    expect(reminders).toEqual([
      { language: 'bg', sending: 1, paused: 1 },
      { language: 'en', sending: 1, paused: 0 },
    ])
    expect(reminders.reduce((sum, row) => sum + row.sending + row.paused, 0)).toBe((await accountStats(h.deps)).reminders)
  })
})
