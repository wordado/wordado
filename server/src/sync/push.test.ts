import { computeXp, dayToIsoDate, localDay, replay, SYNC_PAGE_SIZE, type ReviewEvent, type ReviewState } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { BASE_URL, harness, type Harness, type Session } from '../../test/harness'
import { pushPage, rawEvent, TZ } from '../../test/events'
import { loadEvents, toStampedEvent } from './events'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

async function eventRows(h: Harness, userId: string) {
  return h.deps.db.query<{ review_id: string; client_ts: number; effective_ts: number; xp_eligible: boolean; grade: number }>(
    'select review_id, client_ts, effective_ts, xp_eligible, grade from review_event where user_id = $1 order by device_id, device_seq',
    [userId],
  )
}

async function mark(h: Harness, userId: string, deviceId: string) {
  const [row] = await h.deps.db.query<{ device_seq: number; effective_ts: number }>(
    'select device_seq, effective_ts from device where user_id = $1 and device_id = $2',
    [userId, deviceId],
  )
  return row ?? null
}

async function xpTotal(h: Harness, userId: string): Promise<number> {
  const [row] = await h.deps.db.query<{ xp: number }>('select coalesce(sum(xp_award), 0)::int8 as xp from review_event where user_id = $1', [userId])
  return row?.xp ?? 0
}

/** Pretends the account was made `days` ago, so a device's older answers fall inside its first window. */
async function ageAccount(h: Harness, session: Session, days: number): Promise<void> {
  await h.deps.db.query('update "user" set "createdAt" = $2 where id = $1', [session.userId, new Date(h.clock.now - days * DAY)])
}

/** The derived rows must always be core's derivation of the stored log. */
async function expectDerivedFromLog(h: Harness, userId: string): Promise<void> {
  const events = (await loadEvents(h.deps.db, userId)).map(toStampedEvent)
  const states = await h.deps.db.query<{ state: ReviewState }>('select state from review_state where user_id = $1', [userId])
  expect(new Map(states.map((r) => [r.state.wordId, r.state]))).toEqual(replay(events))
  expect(await xpTotal(h, userId)).toBe(computeXp(events).total)
}

describe('POST /v1/sync/push (spec §9.2)', () => {
  it('stamps a page, stores it, advances the device mark and derives the words', async () => {
    const h = harness()
    const s = await h.signIn()
    const events = [1, 2, 3].map((n) => rawEvent('dev-a', n, h.clock.now - (10 - n) * MINUTE, { wordId: `c:w-${n}` }))
    const reply = await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, events))
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ status: 'ok', documents: [], rejected: [] })
    const rows = await eventRows(h, s.userId)
    expect(rows.map((r) => [r.effective_ts === r.client_ts, r.xp_eligible])).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ])
    expect(await mark(h, s.userId, 'dev-a')).toEqual({ device_seq: 3, effective_ts: events[2]!.clientTs })
    await expectDerivedFromLog(h, s.userId)
    expect(await xpTotal(h, s.userId)).toBe(30)
  })

  it('keeps the first write of a reviewId and ignores a second payload (roadmap contract)', async () => {
    const h = harness()
    const s = await h.signIn()
    const first = rawEvent('dev-a', 1, h.clock.now - MINUTE)
    await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [first]))
    await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [{ ...first, grade: 1 }]))
    const rows = await eventRows(h, s.userId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.grade).toBe(first.grade)
  })

  it('corrects a skewed device clock as a whole, keeping its spacing and its XP (spec §9.2 step 2)', async () => {
    const h = harness()
    const s = await h.signIn()
    const fast = h.clock.now + HOUR
    const events = [1, 2, 3].map((n) => rawEvent('dev-a', n, fast - (10 - n) * MINUTE, { wordId: `c:w-${n}` }))
    await s.post('/v1/sync/push', pushPage('dev-a', fast, events))
    const rows = await eventRows(h, s.userId)
    expect(rows.map((r) => r.client_ts - r.effective_ts)).toEqual([HOUR, HOUR, HOUR])
    expect(rows.every((r) => r.xp_eligible)).toBe(true)
  })

  it('accepts a never-seen device back to a day before the account existed, and clamps only what is older (spec §8.6)', async () => {
    const h = harness()
    const s = await h.signIn()
    const demo = rawEvent('dev-demo', 1, h.clock.now - 2 * HOUR)
    const ancient = rawEvent('dev-demo', 2, h.clock.now - 3 * DAY, { wordId: 'c:w-2' })
    await s.post('/v1/sync/push', pushPage('dev-demo', h.clock.now, [demo, ancient]))
    const [first, second] = await eventRows(h, s.userId)
    expect(first).toMatchObject({ effective_ts: demo.clientTs, xp_eligible: true })
    // Clamped to the lower bound, then kept in device order: never before the first answer.
    expect(second!.xp_eligible).toBe(false)
    expect(second!.effective_ts).toBe(demo.clientTs)
  })

  it('judges a week-old backlog of 1,200 answers in three pages against one window (Review Focus)', async () => {
    const h = harness()
    const s = await h.signIn()
    await ageAccount(h, s, 30)
    const start = h.clock.now - 7 * DAY
    const events = Array.from({ length: 1200 }, (_, i) =>
      rawEvent('dev-a', i + 1, start + i * 8 * MINUTE, { wordId: `c:w-${i % 150}` }),
    )
    const clientNow = h.clock.now
    const pages = [0, 1, 2].map((p) => events.slice(p * 400, (p + 1) * 400))
    expect(pages.every((p) => p.length <= SYNC_PAGE_SIZE)).toBe(true)
    for (const [p, pageEvents] of pages.entries()) {
      const reply = await s.post('/v1/sync/push', pushPage('dev-a', clientNow, pageEvents, { pushId: 'backlog', page: p, lastPage: p === 2 }))
      expect(reply.body.status).toBe('ok')
      h.clock.advance(1_000)
    }
    const rows = await eventRows(h, s.userId)
    expect(rows).toHaveLength(1200)
    expect(rows.filter((r) => r.effective_ts !== r.client_ts)).toEqual([])
    expect(rows.filter((r) => !r.xp_eligible)).toEqual([])
    expect(await mark(h, s.userId, 'dev-a')).toMatchObject({ device_seq: 1200 })
    expect(await h.deps.db.query('select * from push_window where user_id = $1', [s.userId])).toEqual([])
    await expectDerivedFromLog(h, s.userId)
  })

  it('keeps the window of the first page while later pages arrive (spec §9.2 step 1)', async () => {
    const h = harness()
    const s = await h.signIn()
    const clientNow = h.clock.now + HOUR // an hour fast
    const first = rawEvent('dev-a', 1, clientNow - 5 * MINUTE)
    await s.post('/v1/sync/push', pushPage('dev-a', clientNow, [first], { pushId: 'two', page: 0, lastPage: false }))
    expect(await h.deps.db.query('select push_id from push_window where user_id = $1', [s.userId])).toEqual([{ push_id: 'two' }])
    h.clock.advance(5 * MINUTE)
    const second = rawEvent('dev-a', 2, clientNow - MINUTE, { wordId: 'c:w-2' })
    await s.post('/v1/sync/push', pushPage('dev-a', clientNow, [second], { pushId: 'two', page: 1, lastPage: true }))
    const rows = await eventRows(h, s.userId)
    expect(rows.map((r) => r.client_ts - r.effective_ts)).toEqual([HOUR, HOUR])
    expect(await h.deps.db.query('select push_id from push_window where user_id = $1', [s.userId])).toEqual([])
  })

  it('records a completed day only on the last page, and only with an answer on that date (spec §8.4)', async () => {
    const h = harness()
    const s = await h.signIn()
    const answer = rawEvent('dev-a', 1, h.clock.now - MINUTE)
    const date = dayToIsoDate(localDay(answer.clientTs, TZ))
    const yesterday = dayToIsoDate(localDay(answer.clientTs, TZ) - 1)
    const done = [{ localDate: date, ruleVersion: 'r1' }]
    // No answer on that date yet: not accepted.
    await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [], { dayComplete: done }))
    // Not the last page: not evaluated.
    await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [answer], { pushId: 'p', lastPage: false, dayComplete: done }))
    const dates = () => h.deps.db.query('select local_date from day_complete where user_id = $1', [s.userId])
    expect(await dates()).toEqual([])
    await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [], { pushId: 'p', page: 1, lastPage: true, dayComplete: [...done, { localDate: yesterday, ruleVersion: 'r1' }] }))
    expect(await dates()).toEqual([{ local_date: date }])
  })

  it('changes nothing when a push is sent again after its response was lost (Review Focus)', async () => {
    const h = harness()
    const s = await h.signIn()
    const answers = [1, 2, 3, 4].map((n) => rawEvent('dev-a', n, h.clock.now - (10 - n) * MINUTE, { wordId: `c:w-${n}` }))
    const date = dayToIsoDate(localDay(answers[0]!.clientTs, TZ))
    const pages = [
      pushPage('dev-a', h.clock.now, answers.slice(0, 2), { pushId: 'retry', page: 0, lastPage: false }),
      pushPage('dev-a', h.clock.now, answers.slice(2), { pushId: 'retry', page: 1, lastPage: true, dayComplete: [{ localDate: date, ruleVersion: 'r1' }] }),
    ]
    for (const page of pages) await s.post('/v1/sync/push', page)
    const before = { rows: await eventRows(h, s.userId), xp: await xpTotal(h, s.userId), mark: await mark(h, s.userId, 'dev-a') }
    h.clock.advance(30_000)
    for (const page of pages) expect((await s.post('/v1/sync/push', page)).body.status).toBe('ok')
    expect(await eventRows(h, s.userId)).toEqual(before.rows)
    expect(await xpTotal(h, s.userId)).toBe(before.xp)
    expect(await mark(h, s.userId, 'dev-a')).toEqual(before.mark)
    expect(await h.deps.db.query('select local_date from day_complete where user_id = $1', [s.userId])).toEqual([{ local_date: date }])
  })

  it('stores both of two devices pushing at the same moment (Review Focus)', async () => {
    const h = harness()
    const s = await h.signIn()
    const batch = (device: string) =>
      Array.from({ length: 50 }, (_, i) => rawEvent(device, i + 1, h.clock.now - (60 - i) * MINUTE, { wordId: `c:w-${i % 7}` }))
    const replies = await Promise.all([
      s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, batch('dev-a'))),
      s.post('/v1/sync/push', pushPage('dev-b', h.clock.now, batch('dev-b'))),
    ])
    expect(replies.map((r) => r.body.status)).toEqual(['ok', 'ok'])
    expect(await eventRows(h, s.userId)).toHaveLength(100)
    await expectDerivedFromLog(h, s.userId)
  })

  it('answers upgrade_required below the minimum protocol, whatever else the page holds (Review Focus)', async () => {
    const h = harness({ config: { minProtocolVersion: 2 } })
    const s = await h.signIn()
    const old = await s.post('/v1/sync/push', { protocolVersion: 1, somethingOld: [1, 2, 3] })
    expect(old.status).toBe(200)
    expect(old.body).toEqual({ status: 'upgrade_required', minProtocolVersion: 2 })
    const valid = await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [rawEvent('dev-a', 1, h.clock.now - MINUTE)], { protocolVersion: 1 }))
    expect(valid.body).toEqual({ status: 'upgrade_required', minProtocolVersion: 2 })
    expect(await eventRows(h, s.userId)).toEqual([])
  })

  it('refuses a malformed page whole and stores none of it', async () => {
    const h = harness()
    const s = await h.signIn()
    const good = rawEvent('dev-a', 1, h.clock.now - MINUTE)
    const bad: ReviewEvent = { ...rawEvent('dev-a', 2, h.clock.now), clientTzOffsetMin: 900 }
    const reply = await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [good, bad]))
    expect(reply.status).toBe(400)
    expect(reply.body).toEqual({ error: 'invalid', errors: ['events[1].clientTzOffsetMin is invalid'] })
    const notJson = await h.request('/v1/sync/push', { method: 'POST', headers: { cookie: s.cookie, origin: BASE_URL, 'content-type': 'text/plain' }, body: 'hello' })
    expect(notJson.status).toBe(400)
    expect(await eventRows(h, s.userId)).toEqual([])
  })

  it('answers 401 without a session', async () => {
    const h = harness()
    const reply = await h.request('/v1/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pushPage('dev-a', h.clock.now, [])),
    })
    expect(reply.status).toBe(401)
  })
})
