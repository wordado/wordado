import { dayToIsoDate, localDay, replay, SYNC_PROTOCOL_VERSION, type ReviewState } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { harness, type Harness, type Session } from '../../test/harness'
import { pushPage, rawEvent, TZ } from '../../test/events'
import { loadEvents, toStampedEvent } from '../sync/events'
import { EXPORT_FORMAT } from './export'

const MINUTE = 60_000

/** A learner with something in every table: answers, state, a completed day, documents, a report, a half-sent push, a device, a push subscription. */
async function busyLearner(h: Harness, s: Session): Promise<void> {
  const events = [1, 2, 3].map((n) => rawEvent('dev-a', n, h.clock.now - (10 - n) * MINUTE, { wordId: `c:w-${n}` }))
  const date = dayToIsoDate(localDay(events[0]!.clientTs, TZ))
  const reply = await s.post(
    '/v1/sync/push',
    pushPage('dev-a', h.clock.now, events, {
      dayComplete: [{ localDate: date, ruleVersion: 'r1' }],
      documents: [
        { type: 'settings', key: '', patch: { baseVersion: 0, fields: { newWordLimit: 5 } } },
        {
          type: 'content_report',
          key: 'rep-1',
          patch: { baseVersion: 0, fields: { wordId: 'c:w-1', field: 'audio', note: 'robotic', packVersion: 0, createdAt: h.clock.now } },
        },
      ],
    }),
  )
  expect(reply.body.rejected).toEqual([])
  await s.post('/v1/sync/push', pushPage('dev-b', h.clock.now, [rawEvent('dev-b', 1, h.clock.now - MINUTE)], { pushId: 'half', lastPage: false }))
  await h.deps.db.query(
    `insert into push_subscription (endpoint, user_id, p256dh, auth, reminder_minute, tz_offset_min, language, created_at)
     values ($1, $2, 'key', 'auth', 540, 180, 'bg', $3)`,
    [`https://fcm.googleapis.com/fcm/send/${s.userId}`, s.userId, h.clock.now],
  )
  await s.post('/api/auth/update-user', { country: 'BG' })
}

/** Rows anywhere in the database whose text mentions `needle`, by table. */
async function mentions(h: Harness, needle: string): Promise<Record<string, number>> {
  const tables = await h.deps.db.query<{ name: string }>(`select tablename as name from pg_tables where schemaname = 'public'`)
  const out: Record<string, number> = {}
  for (const { name } of tables) {
    const [row] = await h.deps.db.query<{ n: number }>(`select count(*) as n from "${name}" as t where t::text like '%' || $1 || '%'`, [needle])
    if (row && row.n > 0) out[name] = row.n
  }
  return out
}

describe('account deletion (spec §11)', () => {
  it('leaves no row that names the learner, and keeps their reports without them', async () => {
    const h = harness()
    const s = await h.signIn()
    await busyLearner(h, s)
    expect(Object.keys(await mentions(h, s.userId)).length).toBeGreaterThan(8)
    const reply = await s.del('/v1/account', { confirm: true })
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ deleted: true })
    expect(await mentions(h, s.userId)).toEqual({})
    expect(await mentions(h, s.email)).toEqual({})
    expect(await h.deps.db.query('select reporter_id, word_id, note from content_report')).toEqual([
      { reporter_id: null, word_id: 'c:w-1', note: 'robotic' },
    ])
  })

  it('ends the session everywhere: an old cookie can neither read nor write', async () => {
    const h = harness()
    const s = await h.signIn()
    await busyLearner(h, s)
    await s.del('/v1/account', { confirm: true })
    expect((await s.get('/v1/me')).status).toBe(401)
    const push = await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [rawEvent('dev-a', 9, h.clock.now)]))
    expect(push.status).toBe(401)
    expect(await h.deps.db.query('select user_id from learner')).toEqual([])
  })

  it('touches no other learner', async () => {
    const h = harness()
    const leaving = await h.signIn()
    const staying = await h.signIn()
    await busyLearner(h, leaving)
    await busyLearner(h, staying)
    await leaving.del('/v1/account', { confirm: true })
    const pulled = await staying.post('/v1/sync/pull', { protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: 'dev-a', documentsSince: 0 })
    // Three words from dev-a and the one dev-b answered on its unfinished push.
    expect(pulled.body.reviewStates).toHaveLength(4)
    expect(await h.deps.db.query('select reporter_id from content_report where reporter_id is not null')).toEqual([{ reporter_id: staying.userId }])
  })

  it('asks for confirmation', async () => {
    const h = harness()
    const s = await h.signIn()
    expect((await s.del('/v1/account')).status).toBe(400)
    expect((await s.del('/v1/account', { confirm: 'yes' })).status).toBe(400)
    expect((await s.get('/v1/me')).status).toBe(200)
  })
})

describe('data export (spec §11)', () => {
  it('round-trips: the exported answers replay to the pulled state', async () => {
    const h = harness()
    const s = await h.signIn()
    await busyLearner(h, s)
    const reply = await s.get('/v1/export')
    expect(reply.status).toBe(200)
    expect(reply.headers.get('content-disposition')).toMatch(/^attachment; filename="wordado-export-\d{4}-\d{2}-\d{2}\.json"$/)
    const exported = reply.body
    expect(exported.format).toBe(EXPORT_FORMAT)
    expect(exported.account).toEqual({ userId: s.userId, email: s.email, country: 'BG', createdAt: expect.any(Number) })
    const stored = (await loadEvents(h.deps.db, s.userId)).map(toStampedEvent)
    expect(exported.reviewEvents).toHaveLength(stored.length)
    expect(new Set(exported.reviewEvents.map((e: { reviewId: string }) => e.reviewId))).toEqual(new Set(stored.map((e) => e.reviewId)))
    const pulled = await s.post('/v1/sync/pull', { protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: 'dev-a', documentsSince: 0 })
    const byWord = (states: Iterable<ReviewState>) => [...states].sort((a, b) => (a.wordId < b.wordId ? -1 : 1))
    expect(byWord(replay(exported.reviewEvents).values())).toEqual(byWord(pulled.body.reviewStates))
    expect(exported.documents.find((d: { type: string }) => d.type === 'settings')?.fields).toEqual({ newWordLimit: 5 })
    expect(exported.dayComplete).toHaveLength(1)
  })

  it('answers 401 without a session', async () => {
    expect((await harness().request('/v1/export')).status).toBe(401)
  })
})
