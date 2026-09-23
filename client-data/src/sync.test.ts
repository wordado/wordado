import { dayToIsoDate, Grade, localDay, MAX_PAGE_DAY_COMPLETE, MAX_PAGE_DOCUMENTS, SYNC_PAGE_SIZE, SYNC_PROTOCOL_VERSION, type WordId } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { pendingDocumentWrites } from './documents'
import { patchSettings, readEntitlement, readFlags, readSettings, setFlag } from './documentTypes'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import { appendAnswer, loadLearner, recordDayComplete, unpushedEvents, type AnswerInput, type Learner } from './learner'
import { ensureDevice } from './meta'
import { migrate } from './schema'
import { backoffMs, readPulledXp, SyncEngine, type SyncTransport } from './sync'
import { FakeServer } from './testing/fakeServer'
import { testEnv, type TestEnv } from './testing/testEnv'

const answer = (wordId: string, over: Partial<AnswerInput> = {}): AnswerInput => ({
  wordId: wordId as WordId, mode: 'multiple_choice', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 1500, practice: false, ...over,
})

interface Device {
  db: Database
  env: TestEnv
  learner: Learner
  engine: SyncEngine
}

async function device(transport: SyncTransport, env: TestEnv): Promise<Device> {
  const db = new Database(nodeSqliteDriver())
  await migrate(db)
  const learner = await loadLearner(db, await ensureDevice(db, env))
  return { db, env, learner, engine: new SyncEngine({ db, env, learner, transport }) }
}

/** One clock for the server and both devices, so skew is a test's choice. */
function world(over: { minProtocolVersion?: number } = {}) {
  const env = testEnv()
  const server = new FakeServer({ now: () => env.now(), accountCreatedAt: env.now() - 60_000, ...over })
  return { env, server }
}

describe('SyncEngine', () => {
  it('pushes the outbox, pulls the snapshot, and prunes what the marks cover', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    env.advance(2_000)
    await appendAnswer(a.db, env, a.learner, answer('c:water-1', { practice: true }))
    expect(await a.engine.sync()).toBe('synced')
    expect(server.events.size).toBe(2)
    expect(server.devices.get(a.learner.deviceId)?.deviceSeq).toBe(2)
    expect(await unpushedEvents(a.db.driver)).toEqual([])
    expect(a.learner.localEvents).toEqual([])
    expect(a.learner.marks.get(a.learner.deviceId)).toBe(2)
    expect(a.learner.states.get('c:hello-1')?.reps).toBe(1)
    expect(a.engine.status).toMatchObject({ phase: 'idle', pendingEvents: 0, failures: 0, lastError: null, upgradeRequired: false })
    expect(a.engine.status.lastSyncAt).toBe(env.now())
    expect(await readPulledXp(a.db.driver)).toEqual({ total: 12, utcDay: expect.any(Number), today: 12 })
  })

  it('carries progress, completed days and settings to a second device', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    const b = await device(server, env)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    await recordDayComplete(a.db, a.learner, localDay(env.now(), 120), env.now())
    await a.db.transaction((tx) => patchSettings(tx, { newWordLimit: 4 }))
    await a.engine.sync()
    await b.engine.sync()
    expect(b.learner.states.get('c:hello-1')?.reps).toBe(1)
    expect([...b.learner.completeDays]).toEqual([localDay(env.now(), 120)])
    expect((await readSettings(b.db.driver)).newWordLimit).toBe(4)
    expect(await pendingDocumentWrites(a.db.driver)).toEqual([])
  })

  it('merges settings field by field, later arrival winning a contested field', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    const b = await device(server, env)
    await a.engine.sync()
    await b.engine.sync()
    await a.db.transaction((tx) => patchSettings(tx, { newWordLimit: 3, reviewCap: 30 }))
    await b.db.transaction((tx) => patchSettings(tx, { newWordLimit: 7, dailyGoal: 25 }))
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    const merged = { newWordLimit: 7, reviewCap: 30, dailyGoal: 25 }
    expect(await readSettings(a.db.driver)).toMatchObject(merged)
    expect(await readSettings(b.db.driver)).toMatchObject(merged)
  })

  it('pages a large backlog under one push id: documents on page 0, completed days on the last', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    for (let i = 0; i < SYNC_PAGE_SIZE * 2 + 5; i += 1) {
      await appendAnswer(a.db, env, a.learner, answer(`c:w${i}`))
      env.advance(3_000)
    }
    await recordDayComplete(a.db, a.learner, localDay(env.now(), 120), env.now())
    await a.engine.sync()
    expect(server.pushes).toHaveLength(3)
    expect(new Set(server.pushes.map((p) => p.pushId)).size).toBe(1)
    expect(server.pushes.map((p) => p.events.length)).toEqual([SYNC_PAGE_SIZE, SYNC_PAGE_SIZE, 5])
    expect(server.pushes.map((p) => p.lastPage)).toEqual([false, false, true])
    expect(server.pushes.map((p) => p.dayComplete.length)).toEqual([0, 0, 1])
    expect([...server.dayComplete]).toEqual([dayToIsoDate(localDay(env.now(), 120))])
    expect(server.events.size).toBe(SYNC_PAGE_SIZE * 2 + 5)
    expect([...server.events.values()].every((e) => e.xpEligible)).toBe(true)
  })

  it('pages document writes at most a page-full at a time, from page 0, under one push id', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    const count = MAX_PAGE_DOCUMENTS * 2 + 5
    await a.db.transaction(async (tx) => {
      for (let i = 0; i < count; i += 1) await setFlag(tx, `c:w${i}` as WordId, 'known')
    })
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    await recordDayComplete(a.db, a.learner, localDay(env.now(), 120), env.now())
    expect(await a.engine.sync()).toBe('synced')
    expect(server.pushes.map((p) => p.documents.length)).toEqual([MAX_PAGE_DOCUMENTS, MAX_PAGE_DOCUMENTS, 5])
    expect(server.pushes.map((p) => p.events.length)).toEqual([1, 0, 0])
    expect(server.pushes.map((p) => [p.page, p.lastPage])).toEqual([[0, false], [1, false], [2, true]])
    expect(server.pushes.map((p) => p.dayComplete.length)).toEqual([0, 0, 1])
    expect(new Set(server.pushes.map((p) => `${p.pushId}@${p.clientNow}`)).size).toBe(1)
    expect(await pendingDocumentWrites(a.db.driver)).toEqual([])
    expect((await readFlags(a.db.driver)).size).toBe(count)
    expect([...server.documents.keys()].filter((k) => k.startsWith('word_flag/'))).toHaveLength(count)
  })

  it('pages documents beside a backlog of answers', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    for (let i = 0; i < SYNC_PAGE_SIZE + 1; i += 1) {
      await appendAnswer(a.db, env, a.learner, answer(`c:w${i}`))
      env.advance(3_000)
    }
    await a.db.transaction(async (tx) => {
      for (let i = 0; i < MAX_PAGE_DOCUMENTS + 1; i += 1) await setFlag(tx, `c:f${i}` as WordId, 'suspended')
    })
    expect(await a.engine.sync()).toBe('synced')
    expect(server.pushes.map((p) => [p.events.length, p.documents.length])).toEqual([[SYNC_PAGE_SIZE, MAX_PAGE_DOCUMENTS], [1, 1]])
    expect(await pendingDocumentWrites(a.db.driver)).toEqual([])
  })

  it('sends completed days at most a page-full per push, each on its last page after every answer', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    const days = MAX_PAGE_DAY_COMPLETE + 2
    for (let i = 0; i < days; i += 1) {
      await appendAnswer(a.db, env, a.learner, answer(`c:w${i}`))
      await recordDayComplete(a.db, a.learner, localDay(env.now(), 120), env.now())
      env.advance(86_400_000)
    }
    expect(await a.engine.sync()).toBe('synced')
    expect(server.pushes.map((p) => [p.events.length, p.dayComplete.length, p.lastPage])).toEqual([
      [days, MAX_PAGE_DAY_COMPLETE, true],
      [0, 2, true],
    ])
    expect(server.dayComplete.size).toBe(days)
    expect(await a.db.all('SELECT count(*) AS c FROM day_complete WHERE pushed = 0')).toEqual([{ c: 0 }])
  })

  it('has the fake refuse the pages the real server refuses', async () => {
    const { server } = world()
    const flag = (i: number) => ({ type: 'word_flag', key: `c:w${i}`, patch: { baseVersion: 0, fields: { flag: 'known' } } })
    const page = {
      protocolVersion: SYNC_PROTOCOL_VERSION, pushId: 'p-1', clientNow: 0, deviceId: 'd-1', page: 0, lastPage: true, events: [], dayComplete: [],
      documents: Array.from({ length: MAX_PAGE_DOCUMENTS + 1 }, (_, i) => flag(i)),
    }
    await expect(server.push(page)).rejects.toThrow(/400/)
    expect(server.documents.size).toBe(0)
  })

  it('keeps a completed day whose answers arrive on a later page of the same push', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    for (let i = 0; i < SYNC_PAGE_SIZE; i += 1) {
      await appendAnswer(a.db, env, a.learner, answer(`c:w${i}`))
      env.advance(3_000)
    }
    env.advance(24 * 3_600_000)
    await appendAnswer(a.db, env, a.learner, answer('c:later-1'))
    const day = localDay(env.now(), 120)
    await recordDayComplete(a.db, a.learner, day, env.now())
    await a.engine.sync()
    expect([...server.dayComplete]).toEqual([dayToIsoDate(day)])
    expect(await a.db.all("SELECT pushed FROM day_complete")).toEqual([{ pushed: 1 }])
  })

  it('lets the server drop a completed day with no answer on that date, without retrying it', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    await recordDayComplete(a.db, a.learner, localDay(env.now(), 120) + 1, env.now())
    await a.engine.sync()
    expect(server.dayComplete.size).toBe(0)
    server.pushes.length = 0
    await a.engine.sync()
    expect(server.pushes).toHaveLength(0)
  })

  it('refreshes every document after a rejected write, so no phantom field survives', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    await a.db.transaction((tx) => patchSettings(tx, { newWordLimit: 4 }))
    await a.engine.sync()
    // An edit whose base the server never issued: rejected as base_ahead_of_server.
    await a.db.transaction((tx) =>
      tx.run("UPDATE document SET fields = ?, patch = ? WHERE type = 'settings'", [
        JSON.stringify({ newWordLimit: 9 }),
        JSON.stringify({ baseVersion: 99, fields: { newWordLimit: 9 } }),
      ]),
    )
    expect((await readSettings(a.db.driver)).newWordLimit).toBe(9)
    await a.engine.sync()
    expect(await pendingDocumentWrites(a.db.driver)).toEqual([])
    expect((await readSettings(a.db.driver)).newWordLimit).toBe(4)
  })

  it('carries a flag and its removal across devices', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    const b = await device(server, env)
    await a.db.transaction((tx) => setFlag(tx, 'c:hello-1', 'known'))
    await a.engine.sync()
    await b.engine.sync()
    expect([...(await readFlags(b.db.driver))]).toEqual([['c:hello-1', 'known']])
    await a.db.transaction((tx) => setFlag(tx, 'c:hello-1', null))
    await a.engine.sync()
    await b.engine.sync()
    expect([...(await readFlags(b.db.driver))]).toEqual([])
  })

  it('resumes a backlog whose second page failed under a new push id', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    for (let i = 0; i < SYNC_PAGE_SIZE + 3; i += 1) {
      await appendAnswer(a.db, env, a.learner, answer(`c:w${i}`))
      env.advance(3_000)
    }
    server.failOnPushPage = 1
    expect(await a.engine.sync()).toBe('failed')
    expect(server.events.size).toBe(SYNC_PAGE_SIZE)
    expect(await unpushedEvents(a.db.driver)).toHaveLength(3)
    expect(await a.engine.sync({ force: true })).toBe('synced')
    expect(server.events.size).toBe(SYNC_PAGE_SIZE + 3)
    expect(new Set(server.pushes.map((p) => p.pushId)).size).toBe(2)
  })

  it('retries idempotently when the response is lost after the server applied the push', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    server.failAfterNext = true
    expect(await a.engine.sync()).toBe('failed')
    expect(await unpushedEvents(a.db.driver)).toHaveLength(1)
    expect(await a.engine.sync({ force: true })).toBe('synced')
    expect(server.events.size).toBe(1)
    expect(server.pushes).toHaveLength(2)
  })

  it('backs off after a failure and honours force', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    server.failNext = new Error('offline')
    expect(await a.engine.sync()).toBe('failed')
    expect(a.engine.status).toMatchObject({ failures: 1, lastError: 'offline' })
    expect(a.engine.status.nextAttemptAt).toBeGreaterThan(env.now())
    expect(await a.engine.sync()).toBe('skipped')
    env.advance(10 * 60_000)
    expect(await a.engine.sync()).toBe('synced')
    expect(a.engine.status.failures).toBe(0)
    expect(a.engine.status.nextAttemptAt).toBeNull()
  })

  it('stops when the server requires an upgrade, keeping the outbox', async () => {
    const { env, server } = world({ minProtocolVersion: 2 })
    const a = await device(server, env)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    expect(await a.engine.sync()).toBe('upgrade_required')
    expect(a.engine.status.upgradeRequired).toBe(true)
    expect(await unpushedEvents(a.db.driver)).toHaveLength(1)
    expect(await a.engine.sync({ force: true })).toBe('skipped')
  })

  it('caches the server-owned entitlement and drops a rejected write', async () => {
    const { env, server } = world()
    server.setServerOwned('entitlement', '', { tier: 'free', source: 'default', expiresAt: null, quotas: { enrichmentPerDay: 20 } }, env.now() + 86_400_000)
    const a = await device(server, env)
    await a.engine.sync()
    expect(await readEntitlement(a.db.driver)).toMatchObject({ tier: 'free', version: 1, staleAfter: env.now() + 86_400_000 })
    await a.db.transaction((tx) => tx.run("UPDATE document SET patch = ? WHERE type = 'entitlement'", [JSON.stringify({ baseVersion: 1, fields: { tier: 'plus' } })]))
    await a.engine.sync()
    expect(await pendingDocumentWrites(a.db.driver)).toEqual([])
    expect((await readEntitlement(a.db.driver))?.tier).toBe('free')
  })

  it('corrects a skewed clock as a whole and loses no XP', async () => {
    const { env, server } = world()
    const skewed = testEnv(env.now() + 3_600_000)
    const a = await device(server, skewed)
    await appendAnswer(a.db, skewed, a.learner, answer('c:hello-1'))
    skewed.advance(5_000)
    await appendAnswer(a.db, skewed, a.learner, answer('c:water-1'))
    await a.engine.sync()
    const stamped = [...server.events.values()].sort((x, y) => x.deviceSeq - y.deviceSeq)
    expect(stamped.map((e) => e.xpEligible)).toEqual([true, true])
    expect(stamped[1]!.effectiveTs - stamped[0]!.effectiveTs).toBe(5_000)
    expect(stamped[0]!.effectiveTs).toBeLessThanOrEqual(env.now())
  })

  it('coalesces concurrent calls into one run', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    const [x, y] = await Promise.all([a.engine.sync(), a.engine.sync()])
    expect([x, y]).toEqual(['synced', 'synced'])
    expect(server.pushes).toHaveLength(1)
  })
})

describe('backoffMs', () => {
  it('doubles from a second to a five-minute ceiling with jitter', () => {
    const half = () => 0
    const full = () => 1
    expect(backoffMs(1, half)).toBe(500)
    expect(backoffMs(1, full)).toBe(1_500)
    expect(backoffMs(4, half)).toBe(4_000)
    expect(backoffMs(20, full)).toBe(450_000)
  })
})
