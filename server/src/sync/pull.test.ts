import {
  classifyEvents,
  computeXp,
  DOCUMENT_TYPES,
  ENTITLEMENT_STALE_AFTER_MS,
  localDay,
  dayToIsoDate,
  Grade,
  replay,
  SCHEDULER_VERSION,
  summarizeDays,
  SYNC_PROTOCOL_VERSION,
  utcDay,
  type PullRequest,
  type ReviewState,
} from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { harness, type Harness, type Session } from '../../test/harness'
import { pushPage, rawEvent, TZ } from '../../test/events'
import { defaultEntitlementFields } from '../learner'
import { loadEvents, toStampedEvent } from './events'

const MINUTE = 60_000
const DAY = 86_400_000

const request = (over: Partial<PullRequest> = {}): PullRequest => ({ protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: 'dev-a', documentsSince: 0, ...over })

const byWord = (states: readonly ReviewState[]) => [...states].sort((a, b) => (a.wordId < b.wordId ? -1 : 1))

async function storedLog(h: Harness, s: Session) {
  return (await loadEvents(h.deps.db, s.userId)).map(toStampedEvent)
}

describe('POST /v1/sync/pull (spec §9.2)', () => {
  it('gives a new learner an empty state and the entitlement, fresh', async () => {
    const h = harness()
    const s = await h.signIn()
    const reply = await s.post('/v1/sync/pull', request())
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({
      status: 'ok',
      serverNow: h.clock.now,
      schedulerVersion: SCHEDULER_VERSION,
      reviewStates: [],
      deviceMarks: {},
      summaries: [],
      dayComplete: [],
      documents: [
        {
          type: DOCUMENT_TYPES.entitlement,
          key: '',
          class: 'server_owned',
          version: 1,
          fields: defaultEntitlementFields(),
          fieldVersions: {},
          deleted: false,
          staleAfter: h.clock.now + ENTITLEMENT_STALE_AFTER_MS,
        },
      ],
      documentsVersion: 1,
      xp: { total: 0, utcDay: utcDay(h.clock.now), today: 0 },
    })
  })

  it("returns core's derivation of the stored log, the marks, completed days and XP", async () => {
    const h = harness()
    const s = await h.signIn()
    const a = [1, 2, 3, 4].map((n) => rawEvent('dev-a', n, h.clock.now - (30 - n) * MINUTE, { wordId: `c:w-${n % 3}` }))
    const b = [1, 2].map((n) => rawEvent('dev-b', n, h.clock.now - (20 - n) * MINUTE, { wordId: `c:w-${n}`, practice: n === 2 }))
    const date = dayToIsoDate(localDay(a[0]!.clientTs, TZ))
    await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, a, { dayComplete: [{ localDate: date, ruleVersion: 'r1' }] }))
    await s.post('/v1/sync/push', pushPage('dev-b', h.clock.now, b))
    const reply = (await s.post('/v1/sync/pull', request())).body
    const log = await storedLog(h, s)
    expect(byWord(reply.reviewStates)).toEqual(byWord([...replay(log).values()]))
    expect(reply.deviceMarks).toEqual({ 'dev-a': 4, 'dev-b': 2 })
    expect(reply.summaries).toEqual([...summarizeDays(classifyEvents(log)).values()].sort((x, y) => x.day - y.day))
    expect(reply.dayComplete).toEqual([date])
    const xp = computeXp(log)
    expect(reply.xp).toEqual({ total: xp.total, utcDay: utcDay(h.clock.now), today: xp.byUtcDay.get(utcDay(h.clock.now)) ?? 0 })
  })

  it("summarises real reviews exactly as core's summarizeDays does, across time zones (spec §8.3)", async () => {
    const h = harness()
    const s = await h.signIn()
    await h.deps.db.query('update "user" set "createdAt" = $2 where id = $1', [s.userId, new Date(h.clock.now - 30 * DAY)])
    const t = h.clock.now
    // dev-a in Tokyo (+9h), dev-b in New York (-5h): the same instant falls on different local days.
    const tokyo = { clientTzOffsetMin: 540 }
    const newYork = { clientTzOffsetMin: -300 }
    const a = [
      rawEvent('dev-a', 1, t - 3 * DAY, { ...tokyo, wordId: 'c:w-1' }),
      rawEvent('dev-a', 2, t - 3 * DAY + MINUTE, { ...tokyo, wordId: 'c:w-2' }),
      rawEvent('dev-a', 3, t - 3 * DAY + 2 * MINUTE, { ...tokyo, wordId: 'c:w-3' }),
      rawEvent('dev-a', 4, t - 3 * DAY + 3 * MINUTE, { ...tokyo, wordId: 'c:w-1', grade: Grade.Again }),
      rawEvent('dev-a', 5, t - 30 * MINUTE, { ...tokyo, wordId: 'c:w-1', grade: Grade.Again }),
      rawEvent('dev-a', 6, t - 29 * MINUTE, { ...tokyo, wordId: 'c:w-2', grade: Grade.Good }),
      rawEvent('dev-a', 7, t - 28 * MINUTE, { ...tokyo, wordId: 'c:w-1', grade: Grade.Good }),
      rawEvent('dev-a', 8, t - 27 * MINUTE, { ...tokyo, wordId: 'c:w-9', practice: true }),
    ]
    const b = [
      rawEvent('dev-b', 1, t - 2 * DAY, { ...newYork, wordId: 'c:w-4' }),
      rawEvent('dev-b', 2, t - 20 * MINUTE, { ...newYork, wordId: 'c:w-4', grade: Grade.Hard }),
      rawEvent('dev-b', 3, t - 19 * MINUTE, { ...newYork, wordId: 'c:w-3', grade: Grade.Again }),
    ]
    await s.post('/v1/sync/push', pushPage('dev-a', t, a))
    await s.post('/v1/sync/push', pushPage('dev-b', t, b))
    const reply = (await s.post('/v1/sync/pull', request())).body
    const log = await storedLog(h, s)
    expect(log).toHaveLength(11)
    const expected = [...summarizeDays(classifyEvents(log)).values()].sort((x, y) => x.day - y.day)
    expect(reply.summaries).toEqual(expected)
    // Not vacuous: real reviews, some failed.
    expect(reply.summaries.some((d: { reviews: number; successes: number }) => d.reviews > 0 && d.successes < d.reviews)).toBe(true)
  })

  it('returns only documents above the cursor, and every server-owned one', async () => {
    const h = harness()
    const s = await h.signIn()
    const flag = (key: string) => ({ type: 'word_flag', key, patch: { baseVersion: 0, fields: { flag: 'known' } } })
    await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [], { documents: [flag('c:w-1'), flag('c:w-2'), flag('c:w-3')] }))
    const reply = (await s.post('/v1/sync/pull', request({ documentsSince: 3 }))).body
    expect(reply.documents.map((d: { type: string; version: number }) => [d.type, d.version])).toEqual([
      ['entitlement', 1],
      ['word_flag', 4],
    ])
    expect(reply.documentsVersion).toBe(4)
  })

  it('trims the summary to the trailing 90 days (spec §8.3)', async () => {
    const h = harness()
    const s = await h.signIn()
    await h.deps.db.query('update "user" set "createdAt" = $2 where id = $1', [s.userId, new Date(h.clock.now - 200 * DAY)])
    const old = rawEvent('dev-a', 1, h.clock.now - 120 * DAY, { wordId: 'c:old' })
    const recent = rawEvent('dev-a', 2, h.clock.now - 10 * DAY, { wordId: 'c:recent' })
    await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [old, recent]))
    const reply = (await s.post('/v1/sync/pull', request())).body
    expect(reply.summaries.map((d: { day: number }) => d.day)).toEqual([localDay(recent.clientTs, TZ)])
    // The state still includes the old word: only the summary is trimmed.
    expect(reply.reviewStates.map((r: ReviewState) => r.wordId).sort()).toEqual(['c:old', 'c:recent'])
  })

  it('reads marks and states from one moment, even with a push in flight (spec §4.3)', async () => {
    const h = harness()
    const s = await h.signIn()
    for (let round = 0; round < 5; round += 1) {
      const events = Array.from({ length: 40 }, (_, i) => rawEvent('dev-a', round * 40 + i + 1, h.clock.now - (300 - round * 40 - i) * 1000, { wordId: `c:w-${i % 9}` }))
      const [, pulled] = await Promise.all([s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, events)), s.post('/v1/sync/pull', request())])
      const mark: number = pulled.body.deviceMarks['dev-a'] ?? 0
      const upToMark = (await storedLog(h, s)).filter((e) => e.deviceSeq <= mark)
      expect(byWord(pulled.body.reviewStates)).toEqual(byWord([...replay(upToMark).values()]))
    }
  })

  it('answers upgrade_required below the minimum, 400 when malformed, 401 without a session', async () => {
    const h = harness({ config: { minProtocolVersion: 2 } })
    const s = await h.signIn()
    expect((await s.post('/v1/sync/pull', request({ protocolVersion: 1 }))).body).toEqual({ status: 'upgrade_required', minProtocolVersion: 2 })
    expect((await s.post('/v1/sync/pull', { protocolVersion: 2, deviceId: 'dev-a', documentsSince: -1 })).status).toBe(400)
    const anonymous = await h.request('/v1/sync/pull', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request()) })
    expect(anonymous.status).toBe(401)
  })
})
