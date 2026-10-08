import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, Grade, type Pack, type PackDescriptor, type PackManifest } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Client, ClientClosed } from './client'
import { Database } from './database'
import { DOC } from './documentTypes'
import { writeLocalPatch } from './documents'
import type { SqlDriver } from './driver'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import type { AnswerInput } from './learner'
import { installPacks, type PackFetcher } from './packs'
import { accountIsEmpty, UpgradeRequiredError } from './sync'
import { FakeServer } from './testing/fakeServer'
import { testEnv, type TestEnv } from './testing/testEnv'

const SAMPLE_DIR = fileURLToPath(new URL('../../pipeline/samples/a1/', import.meta.url))
const manifest = JSON.parse(readFileSync(join(SAMPLE_DIR, 'manifest.json'), 'utf8')) as PackManifest
const fromDisk: PackFetcher = async (d) => new Uint8Array(readFileSync(join(SAMPLE_DIR, d.url)))
const answer = (wordId: string, over: Partial<AnswerInput> = {}): AnswerInput => ({
  wordId: wordId as AnswerInput['wordId'], mode: 'multiple_choice', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 1500, practice: false, ...over,
})

async function openClient(env: TestEnv = testEnv(), server?: FakeServer): Promise<Client> {
  const client = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg', ...(server ? { transport: server } : {}) })
  await client.installPacks(manifest, fromDisk)
  await client.startSession()
  return client
}

/** The sample Bulgarian pack at a higher corpus version, with its manifest, as the CDN would serve it (a background upgrade check). */
async function nextBgVersion(env: TestEnv): Promise<{ manifest: PackManifest; fetch: PackFetcher }> {
  const pack = JSON.parse(readFileSync(join(SAMPLE_DIR, 'corpus-v0-bg.pack'), 'utf8')) as Pack
  const bytes = new TextEncoder().encode(canonicalJson({ ...pack, corpus_version: 1 }))
  const descriptor: PackDescriptor = { ...manifest.packs[0]!, corpus_version: 1, url: 'corpus-v1-bg.pack', sha256: await env.sha256(bytes), bytes: bytes.byteLength }
  return { manifest: { ...manifest, corpus_version: 1, packs: [descriptor] }, fetch: async () => bytes }
}

describe('Client', () => {
  it('opens empty, then serves a plan once a pack is active', async () => {
    const env = testEnv()
    const client = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg' })
    expect(client.snapshot.corpus).toBeNull()
    expect(client.snapshot.plan).toBeNull()
    expect(client.snapshot.deviceId).toMatch(/^00000000/)
    await client.installPacks(manifest, fromDisk)
    expect(client.snapshot.corpus).toBeNull()
    expect(await client.startSession()).toEqual(['corpus-bg'])
    expect(client.snapshot.corpus?.entries.size).toBe(60)
    expect(client.snapshot.plan?.newWords).toHaveLength(10)
    expect(client.snapshot.progress?.tiers.new).toBe(60)
    expect(client.entry('c:hello-1')?.headword).toBe('hello')
  })

  it('records an answer, unlocks, completes the day and notifies subscribers', async () => {
    const client = await openClient()
    let notified = 0
    client.store.subscribe(() => {
      notified += 1
    })
    const first = await client.answer(answer('c:hello-1'))
    expect(first.unlocked).toEqual(['a1-01'])
    expect(first.dayCompleted).toBe(true)
    expect(client.snapshot.plan?.newWords).toHaveLength(9)
    expect(client.snapshot.plan?.newWords).not.toContain('c:hello-1')
    expect(client.snapshot.states.get('c:hello-1')?.reps).toBe(1)
    expect(client.snapshot.progress?.streak.todayComplete).toBe(true)
    expect(client.snapshot.xp).toEqual({ total: 10, today: 10, provisional: 10 })
    const second = await client.answer(answer('c:goodbye-1'))
    expect(second).toMatchObject({ dayCompleted: false, unlocked: [] })
    expect(notified).toBeGreaterThanOrEqual(2)
  })

  it('applies settings and flags to the plan', async () => {
    const client = await openClient()
    await client.updateSettings({ newWordLimit: 2 })
    expect(client.snapshot.settings.newWordLimit).toBe(2)
    expect(client.snapshot.plan?.newWords).toEqual(['c:hello-1', 'c:goodbye-1'])
    await client.setFlag('c:hello-1', 'known')
    expect(client.snapshot.plan?.newWords).toEqual(['c:goodbye-1', 'c:please-1'])
    expect(client.snapshot.progress?.tiers.new).toBe(59)
    await expect(client.updateSettings({ newWordLimit: 99 })).rejects.toThrow(/newWordLimit/)
  })

  it('syncs through the transport and reflects the server\'s XP and entitlement', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: () => env.now(), accountCreatedAt: env.now() - 60_000 })
    server.setServerOwned('entitlement', '', { tier: 'free', source: 'default', expiresAt: null, quotas: { enrichmentPerDay: 20 } }, env.now() + 86_400_000)
    const client = await openClient(env, server)
    await client.answer(answer('c:hello-1'))
    expect(await client.sync()).toBe('synced')
    expect(client.snapshot.sync.lastSyncAt).toBe(env.now())
    expect(client.snapshot.xp).toEqual({ total: 10, today: 10, provisional: 0 })
    expect(client.snapshot.entitlement?.tier).toBe('free')
    expect(client.canUse('collections.theme')).toBe(true)
    expect(client.canUse('forecast')).toBe(false)
    expect(client.snapshot.plan?.newWords).toHaveLength(9)
  })

  it('files a report, attaches a user, and says listening needs a clip', async () => {
    const client = await openClient()
    expect(await client.report({ wordId: 'c:hello-1', field: 'audio', note: '', packVersion: 0 })).toMatch(/^00000000/)
    await client.attachUser('user-1')
    expect(client.snapshot.userId).toBe('user-1')
    expect([...client.availableModes('c:hello-1', new Set(), false)]).toEqual(['flashcard', 'multiple_choice'])
    expect([...client.availableModes('c:hello-1', new Set(['hello-1-uk']), false)]).toContain('listening_select')
    expect(await client.sync()).toBe('skipped')
    await client.close()
  })
})

describe('Client views for the screens', () => {
  it('shows the first unit unlocked and current before any answer', async () => {
    const client = await openClient()
    expect(client.snapshot.path).toEqual({ unlocked: new Set(['a1-01']), currentUnitId: 'a1-01' })
    expect(client.snapshot.packVersion).toBe(0)
  })

  it('lists the clips of the words about to be met, once each', async () => {
    const client = await openClient()
    const clips = client.upcomingClips()
    expect(clips).toHaveLength(10)
    expect(new Set(clips.map((c) => c.clipId)).size).toBe(10)
    expect(clips[0]?.url).toMatch(/^audio\/.+\.m4a$/)
  })

  it('has no path, pack version or clips before a pack is active', async () => {
    const client = await Client.open({ driver: nodeSqliteDriver(), env: testEnv(), l1: 'bg' })
    expect(client.snapshot.path).toBeNull()
    expect(client.snapshot.packVersion).toBeNull()
    expect(client.upcomingClips()).toEqual([])
  })
})

/** A driver whose document writes can be made to fail, as a full disk would. */
function failingDocuments(driver: SqlDriver): { driver: SqlDriver; fail: { on: boolean } } {
  const fail = { on: false }
  return {
    fail,
    driver: {
      ...driver,
      run: async (sql, params) => {
        if (fail.on && /INSERT INTO document/.test(sql)) throw new Error('disk full')
        await driver.run(sql, params)
      },
    },
  }
}

/** A driver whose day-complete write (what `recordDayComplete` issues) can be made to fail. */
function failingDayComplete(driver: SqlDriver): { driver: SqlDriver; fail: { on: boolean } } {
  const fail = { on: false }
  return {
    fail,
    driver: {
      ...driver,
      run: async (sql, params) => {
        if (fail.on && /INSERT OR IGNORE INTO day_complete/.test(sql)) throw new Error('disk full')
        await driver.run(sql, params)
      },
    },
  }
}

describe('Learn this word (spec §7.4)', () => {
  it('marks a word offline, serves it first within the daily limit, and takes the mark back', async () => {
    const env = testEnv()
    const driver = nodeSqliteDriver()
    const client = await Client.open({ driver, env, l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    await client.updateSettings({ newWordLimit: 3 })
    expect(client.snapshot.toLearn).toEqual([])
    expect(client.snapshot.plan!.newWords).toEqual(['c:hello-1', 'c:goodbye-1', 'c:please-1'])
    // No transport: the mark is the device's own until an account syncs it.
    await client.setToLearn('c:bread-1', true)
    env.advance(1_000)
    await client.setToLearn('c:apple-1', true)
    expect(client.snapshot.toLearn).toEqual(['c:bread-1', 'c:apple-1'])
    // Still three new words today: the two chosen ones, then the path.
    expect(client.snapshot.plan!.newWords).toEqual(['c:bread-1', 'c:apple-1', 'c:hello-1'])
    // A chosen word stays practisable and unflagged.
    expect(client.snapshot.flags.size).toBe(0)
    expect(await client.hasUnsynced()).toBe(true)
    // It is on disk: a second open of the same database reads it.
    const again = await Client.open({ driver, env, l1: 'bg' })
    expect(again.snapshot.toLearn).toEqual(['c:bread-1', 'c:apple-1'])
    await client.setToLearn('c:bread-1', false)
    expect(client.snapshot.toLearn).toEqual(['c:apple-1'])
    expect(client.snapshot.plan!.newWords).toEqual(['c:apple-1', 'c:hello-1', 'c:goodbye-1'])
    // Chosen again, it goes to the back of the line.
    env.advance(1_000)
    await client.setToLearn('c:bread-1', true)
    expect(client.snapshot.toLearn).toEqual(['c:apple-1', 'c:bread-1'])
  })

  it('spends the mark once the word is started, counts it as one of the day’s new words, and leaves a skipped level skipped', async () => {
    const env = testEnv()
    const client = await openClient(env)
    await client.updateSettings({ declaredLevel: 'A2', newWordLimit: 3 })
    // The whole sample is below A2: the path has nothing to teach, and the chosen word is the day's one new word.
    expect(client.snapshot.plan!.newWords).toEqual([])
    await client.setToLearn('c:bread-1', true)
    expect(client.snapshot.plan!.newWords).toEqual(['c:bread-1'])
    await client.answer(answer('c:bread-1'))
    expect(client.snapshot.states.has('c:bread-1')).toBe(true)
    expect(client.snapshot.toLearn).toEqual([])
    expect(client.snapshot.plan!.newWords).toEqual([])
    expect(client.snapshot.progress!.levels.A1).toEqual({ kind: 'skipped' })
    // The limit counts it: two more chosen words fit today, a third waits.
    for (const wordId of ['c:apple-1', 'c:milk-1', 'c:water-1'] as const) {
      env.advance(1_000)
      await client.setToLearn(wordId, true)
    }
    expect(client.snapshot.plan!.newWords).toEqual(['c:apple-1', 'c:milk-1'])
    // Taking back a spent mark changes nothing.
    await client.setToLearn('c:bread-1', false)
    expect(client.snapshot.states.has('c:bread-1')).toBe(true)
  })

  it('does not serve a chosen word that is set aside, or one the corpus does not hold', async () => {
    const client = await openClient()
    await client.updateSettings({ newWordLimit: 2 })
    await client.setToLearn('c:bread-1', true)
    await client.setToLearn('c:nowhere-1', true)
    expect(client.snapshot.toLearn).toEqual(['c:bread-1'])
    await client.setFlag('c:bread-1', 'known')
    expect(client.snapshot.plan!.newWords).toEqual(['c:hello-1', 'c:goodbye-1'])
    // Setting it aside took the mark with it (the planner's own refusal of a flagged word is core's test).
    expect(client.snapshot.toLearn).toEqual([])
  })

  it('clears the mark when the word is set aside, so bringing it back does not put it first', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: () => env.now(), accountCreatedAt: env.now() - 60_000 })
    const client = await openClient(env, server)
    await client.updateSettings({ newWordLimit: 2 })
    await client.setToLearn('c:bread-1', true)
    await client.setToLearn('c:apple-1', true)
    await client.sync()
    for (const [wordId, flag] of [['c:bread-1', 'known'], ['c:apple-1', 'suspended']] as const) {
      await client.setFlag(wordId, flag)
      expect(client.snapshot.toLearn).not.toContain(wordId)
      await client.setFlag(wordId, null)
    }
    expect(client.snapshot.toLearn).toEqual([])
    expect(client.snapshot.plan!.newWords).toEqual(['c:hello-1', 'c:goodbye-1'])
    await client.sync()
    expect(server.documents.get('word_learn/c:bread-1')).toMatchObject({ deleted: true })
    expect(server.documents.get('word_learn/c:apple-1')).toMatchObject({ deleted: true })
    // Bringing a word back clears nothing: a flag removed leaves another word's mark alone.
    await client.setToLearn('c:milk-1', true)
    await client.setFlag('c:water-1', 'known')
    await client.setFlag('c:water-1', null)
    expect(client.snapshot.toLearn).toEqual(['c:milk-1'])
  })

  it('serves a chosen word once when its level stops being skipped and the path reaches it too', async () => {
    const client = await openClient()
    await client.updateSettings({ declaredLevel: 'A2', newWordLimit: 3 })
    await client.setToLearn('c:goodbye-1', true)
    expect(client.snapshot.plan!.newWords).toEqual(['c:goodbye-1'])
    await client.updateSettings({ declaredLevel: 'A1' })
    expect(client.snapshot.plan!.newWords).toEqual(['c:goodbye-1', 'c:hello-1', 'c:please-1'])
  })

  it('takes a mark back for good when the server refuses it: nothing is left on the device or in the outbox (spec §9.2)', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: () => env.now(), accountCreatedAt: env.now() - 60_000 })
    // A server from before the type existed.
    server.unknownTypes.add('word_learn')
    const client = await openClient(env, server)
    await client.updateSettings({ newWordLimit: 4 })
    await client.setFlag('c:water-1', 'known')
    await client.setToLearn('c:bread-1', true)
    expect(client.snapshot.toLearn).toEqual(['c:bread-1'])
    expect(await client.sync()).toBe('synced')
    expect(client.snapshot.toLearn).toEqual([])
    expect(client.snapshot.plan!.newWords[0]).toBe('c:hello-1')
    expect(await client.hasUnsynced()).toBe(false)
    // The documents pushed beside it are untouched.
    expect(client.snapshot.settings.newWordLimit).toBe(4)
    expect([...client.snapshot.flags]).toEqual([['c:water-1', 'known']])
    expect(server.documents.has('word_learn/c:bread-1')).toBe(false)
    // A reopened app agrees, and once the server knows the type a new mark syncs.
    server.unknownTypes.clear()
    await client.setToLearn('c:bread-1', true)
    expect(await client.sync()).toBe('synced')
    expect(client.snapshot.toLearn).toEqual(['c:bread-1'])
    expect(await client.hasUnsynced()).toBe(false)
    expect(server.documents.get('word_learn/c:bread-1')).toMatchObject({ deleted: false })
  })

  it('syncs the marks to the account and to a second device, and merges what two devices chose', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: () => env.now(), accountCreatedAt: env.now() - 60_000 })
    const a = await openClient(env, server)
    const b = await openClient(env, server)
    await a.setToLearn('c:bread-1', true)
    env.advance(1_000)
    await b.setToLearn('c:apple-1', true)
    expect(await a.sync()).toBe('synced')
    expect(await b.sync()).toBe('synced')
    expect(await a.sync()).toBe('synced')
    expect(a.snapshot.toLearn).toEqual(['c:bread-1', 'c:apple-1'])
    expect(b.snapshot.toLearn).toEqual(['c:bread-1', 'c:apple-1'])
    expect(b.snapshot.plan!.newWords.slice(0, 3)).toEqual(['c:bread-1', 'c:apple-1', 'c:hello-1'])
    expect(await a.hasUnsynced()).toBe(false)
    expect(server.documents.get('word_learn/c:bread-1')).toMatchObject({ class: 'versioned', deleted: false, fields: { at: expect.any(Number) } })
    // One device takes a mark back; the other starts the other word.
    await a.setToLearn('c:bread-1', false)
    await b.answer(answer('c:apple-1'))
    await a.sync()
    await b.sync()
    await a.sync()
    expect(a.snapshot.toLearn).toEqual([])
    expect(b.snapshot.toLearn).toEqual([])
    expect(a.snapshot.states.has('c:apple-1')).toBe(true)
    expect(server.documents.get('word_learn/c:bread-1')).toMatchObject({ deleted: true })
    // A fresh install of the account gets what is left: nothing to learn, and no crash on the spent mark.
    await b.setToLearn('c:milk-1', true)
    await b.sync()
    const c = await openClient(env, server)
    await c.sync()
    expect(c.snapshot.toLearn).toEqual(['c:milk-1'])
  })

  it('reads documents of other shapes without harm: a mark with no time, with fields it does not know, and a type it does not know', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: () => env.now(), accountCreatedAt: env.now() - 60_000 })
    server.putDocument('word_learn', 'c:bread-1', {})
    server.putDocument('word_learn', 'c:apple-1', { at: 'yesterday', by: 'a later build' })
    server.putDocument('word_learn', 'not a word', { at: 5 })
    server.putDocument('word_plan', 'c:milk-1', { when: 'later' })
    server.putDocument('word_flag', 'c:hello-1', { flag: 'known' })
    const client = await openClient(env, server)
    expect(await client.sync()).toBe('synced')
    // Both readable marks count as chosen at the earliest time, in a stable order; the rest is kept and ignored.
    expect(client.snapshot.toLearn).toEqual(['c:apple-1', 'c:bread-1'])
    expect([...client.snapshot.flags]).toEqual([['c:hello-1', 'known']])
    expect(client.snapshot.plan!.newWords.slice(0, 3)).toEqual(['c:apple-1', 'c:bread-1', 'c:goodbye-1'])
    // And a payload with no mark at all is what every account has today.
    const plain = await openClient(env, new FakeServer({ now: () => env.now(), accountCreatedAt: env.now() - 60_000 }))
    expect(await plain.sync()).toBe('synced')
    expect(plain.snapshot.toLearn).toEqual([])
  })
})

describe('Client hand-over (spec §9.1)', () => {
  it('never throws once the answer is saved, so a retry cannot record it twice', async () => {
    const { driver, fail } = failingDocuments(nodeSqliteDriver())
    const client = await Client.open({ driver, env: testEnv(), l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    fail.on = true
    // The first answer unlocks the first unit: a document write, which fails here.
    const result = await client.answer(answer('c:hello-1'))
    expect(result.event.wordId).toBe('c:hello-1')
    expect(result.unlocked).toEqual([])
    expect(client.snapshot.states.get('c:hello-1')?.reps).toBe(1)
    fail.on = false
    // The unlock is not lost: the next answer finds it still owed and records it.
    const next = await client.answer(answer('c:goodbye-1'))
    expect(next.unlocked).toEqual(['a1-01'])
    expect(client.snapshot.sync.pendingEvents).toBe(2)
  })

  it('a completed day a failed write dropped is not lost either: startSession makes it, unlike a retried answer (spec §8.4)', async () => {
    const { driver, fail } = failingDayComplete(nodeSqliteDriver())
    const client = await Client.open({ driver, env: testEnv(), l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    fail.on = true
    // The first answer of the day completes it: the day-complete write, which fails here.
    const result = await client.answer(answer('c:hello-1'))
    expect(result.dayCompleted).toBe(false)
    expect(client.snapshot.progress?.streak.todayComplete).toBe(false)
    fail.on = false
    // Not lost: the next session start finds it still owed and records it.
    await client.startSession()
    expect(client.snapshot.progress?.streak.todayComplete).toBe(true)
  })

  it('close waits for an answer being written, then refuses new work', async () => {
    const client = await openClient()
    const pending = client.answer(answer('c:hello-1'))
    const closing = client.close()
    await expect(pending).resolves.toMatchObject({ event: { wordId: 'c:hello-1' } })
    await closing
    await expect(client.answer(answer('c:goodbye-1'))).rejects.toBeInstanceOf(ClientClosed)
    await expect(client.updateSettings({ audio: false })).rejects.toBeInstanceOf(ClientClosed)
  })

  it('idle resolves at once when nothing is in flight, and after the work when something is', async () => {
    const client = await openClient()
    await client.idle()
    let done = false
    const pending = client.answer(answer('c:hello-1')).then(() => {
      done = true
    })
    await client.idle()
    expect(done).toBe(true)
    await pending
  })

  it('knows when answers, completed days or document writes are unsynced', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const client = await openClient(env, server)
    expect(await client.hasUnsynced()).toBe(false)
    await client.answer(answer('c:hello-1'))
    expect(await client.hasUnsynced()).toBe(true)
    expect(await client.sync()).toBe('synced')
    expect(await client.hasUnsynced()).toBe(false)
    await client.updateSettings({ newWordLimit: 5 })
    expect(await client.hasUnsynced()).toBe(true)
  })
})

describe('attaching a demo to an account (spec §8.6)', () => {
  it('syncs through the transport it is given from then on', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const demo = await openClient(env)
    await demo.answer(answer('c:hello-1'))
    expect(await demo.sync()).toBe('skipped')
    await demo.attachUser('user-1', server)
    expect(demo.snapshot.userId).toBe('user-1')
    expect(await demo.sync({ force: true })).toBe('synced')
    expect([...server.events.values()].map((e) => e.wordId)).toEqual(['c:hello-1'])
    expect(await demo.hasUnsynced()).toBe(false)
  })
})

describe('Client.reports', () => {
  it('returns every report this learner filed, with the corpus version they had', async () => {
    const client = await openClient()
    const key = await client.report({ wordId: 'c:hello-1', field: 'translation', note: 'odd', packVersion: 0 })
    await client.report({ wordId: 'c:bread-1', field: 'other', note: '', packVersion: 0 })
    const reports = await client.reports()
    expect(reports).toHaveLength(2)
    expect(reports.find((r) => r.key === key)).toEqual({ key, wordId: 'c:hello-1', field: 'translation', packVersion: 0, l1: 'bg' })
  })

  it('skips a deleted report, one with an unknown field, and one with an invalid word ID', async () => {
    const driver = nodeSqliteDriver()
    const client = await Client.open({ driver, env: testEnv(), l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    const good = await client.report({ wordId: 'c:hello-1', field: 'translation', note: '', packVersion: 0 })
    const tombstoned = await client.report({ wordId: 'c:goodbye-1', field: 'audio', note: '', packVersion: 0 })
    await writeLocalPatch(driver, DOC.contentReport, tombstoned, {}, true)
    await writeLocalPatch(driver, DOC.contentReport, 'bad-field', { wordId: 'c:hello-1', field: 'nonsense', packVersion: 0 })
    await writeLocalPatch(driver, DOC.contentReport, 'bad-word', { wordId: 'not-a-word-id', field: 'translation', packVersion: 0 })
    const reports = await client.reports()
    expect(reports).toEqual([{ key: good, wordId: 'c:hello-1', field: 'translation', packVersion: 0, l1: 'bg' }])
  })

  it('stores the learner\'s L1 in a report and returns it from reports()', async () => {
    const driver = nodeSqliteDriver()
    const client = await Client.open({ driver, env: testEnv(), l1: 'de' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    const key = await client.report({ wordId: 'c:apple-1', field: 'translation', note: '', packVersion: 0 })
    const reports = await client.reports()
    expect(reports.find((r) => r.key === key)).toEqual({ key, wordId: 'c:apple-1', field: 'translation', packVersion: 0, l1: 'de' })
  })

  it('reads an old stored report with no l1 field as one with l1 absent (fix round 1)', async () => {
    const driver = nodeSqliteDriver()
    const client = await Client.open({ driver, env: testEnv(), l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    await writeLocalPatch(driver, DOC.contentReport, 'legacy', { wordId: 'c:hello-1', field: 'translation', packVersion: 0 })
    const reports = await client.reports()
    expect(reports.find((r) => r.key === 'legacy')).toEqual({ key: 'legacy', wordId: 'c:hello-1', field: 'translation', packVersion: 0 })
  })

  it('drops a stored l1 this build does not support (fix round 1)', async () => {
    const driver = nodeSqliteDriver()
    const client = await Client.open({ driver, env: testEnv(), l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    await writeLocalPatch(driver, DOC.contentReport, 'foreign', { wordId: 'c:hello-1', field: 'translation', packVersion: 0, l1: 'fr' })
    const reports = await client.reports()
    expect(reports.find((r) => r.key === 'foreign')).toEqual({ key: 'foreign', wordId: 'c:hello-1', field: 'translation', packVersion: 0 })
  })
})

describe('Client.changeL1 (spec §8.6)', () => {
  it('switches the corpus, keeping every bit of progress, and drops the old language pack', async () => {
    const env = testEnv()
    const driver = nodeSqliteDriver()
    const client = await Client.open({ driver, env, l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    await client.answer(answer('c:hello-1'))
    await client.answer(answer('c:goodbye-1'))
    await client.answer(answer('c:please-1'))
    await client.setFlag('c:hello-1', 'known')
    const statesBefore = new Map(client.snapshot.states)
    const unlockedBefore = new Set(client.snapshot.unlocked)
    const flagsBefore = new Map(client.snapshot.flags)
    expect(statesBefore.size).toBe(3)
    expect(flagsBefore.get('c:hello-1')).toBe('known')

    await client.updateSettings({ l1: 'de' })
    expect(await client.changeL1('de', manifest, fromDisk)).toEqual({ ok: true })

    expect(client.snapshot.l1).toBe('de')
    expect(client.snapshot.corpus?.l1).toBe('de')
    expect(client.snapshot.states).toEqual(statesBefore)
    expect(client.snapshot.unlocked).toEqual(unlockedBefore)
    expect(client.snapshot.flags).toEqual(flagsBefore)
    expect(client.entry('c:apple-1')?.translations).toEqual(['Apfel'])
    expect(await driver.all("SELECT pack_id FROM pack WHERE pack_id = 'corpus-bg'")).toEqual([])
  })

  it('changes nothing when the new pack cannot be fetched (offline)', async () => {
    const driver = nodeSqliteDriver()
    const client = await Client.open({ driver, env: testEnv(), l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    const outcome = await client.changeL1('de', manifest, () => Promise.reject(new Error('offline')))
    expect(outcome).toEqual({ ok: false, reason: 'unavailable' })
    expect(client.snapshot.l1).toBe('bg')
    expect(client.snapshot.corpus?.l1).toBe('bg')
    expect(await driver.all("SELECT pack_id, status FROM pack WHERE pack_id = 'corpus-bg'")).toEqual([{ pack_id: 'corpus-bg', status: 'active' }])
  })

  it('succeeds and leaves only the new L1 active even when a newer pack of the old L1 is staged (fix round 1)', async () => {
    const env = testEnv()
    const driver = nodeSqliteDriver()
    const client = await Client.open({ driver, env, l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    // A background upgrade check (boot's own `installPacks`) staged a newer corpus-bg, never activated.
    const next = await nextBgVersion(env)
    await client.installPacks(next.manifest, next.fetch)
    expect(await driver.all("SELECT pack_id, status, corpus_version FROM pack WHERE pack_id = 'corpus-bg' ORDER BY status")).toEqual([
      { pack_id: 'corpus-bg', status: 'active', corpus_version: 0 },
      { pack_id: 'corpus-bg', status: 'staged', corpus_version: 1 },
    ])

    expect(await client.changeL1('de', manifest, fromDisk)).toEqual({ ok: true })

    expect(client.snapshot.l1).toBe('de')
    expect(client.snapshot.corpus?.l1).toBe('de')
    expect(await driver.all('SELECT pack_id, status FROM pack')).toEqual([{ pack_id: 'corpus-de', status: 'active' }])

    // A reopen (what every later `Client.open` does) must not throw: the bricking bug left both packs active.
    const reopened = await Client.open({ driver, env, l1: 'de' })
    expect(reopened.snapshot.corpus?.l1).toBe('de')
  })

  it('is picked up from an earlier, interrupted attempt even when this fetch fails', async () => {
    const env = testEnv()
    const driver = nodeSqliteDriver()
    const client = await Client.open({ driver, env, l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    // An earlier `changeL1('de', …)` staged the pack but the app was killed before `activateStagedPacks` ran.
    await installPacks(new Database(driver), env, manifest, 'de', fromDisk)
    expect(await driver.all("SELECT pack_id, status FROM pack WHERE pack_id = 'corpus-de'")).toEqual([{ pack_id: 'corpus-de', status: 'staged' }])

    const outcome = await client.changeL1('de', manifest, () => Promise.reject(new Error('offline')))

    expect(outcome).toEqual({ ok: true })
    expect(client.snapshot.l1).toBe('de')
    expect(await driver.all('SELECT pack_id, status FROM pack')).toEqual([{ pack_id: 'corpus-de', status: 'active' }])
  })

  it('the default L1 only applies until the learner sets one explicitly, and only chooses the first install', async () => {
    const driver = nodeSqliteDriver()
    const env = testEnv()
    const client = await Client.open({ driver, env, l1: 'de' })
    expect(client.snapshot.l1).toBe('de')
    await client.updateSettings({ l1: 'bg' })
    // Nothing is installed yet: the setting decides which language the first install fetches.
    expect(client.snapshot.l1).toBe('bg')

    const reopened = await Client.open({ driver, env, l1: 'de' })
    expect(reopened.snapshot.l1).toBe('bg')
    await reopened.installPacks(manifest, fromDisk)
    expect(await reopened.startSession()).toEqual(['corpus-bg'])
    expect(reopened.snapshot.corpus?.l1).toBe('bg')
  })

  it('a change made offline survives a relaunch as pending: the installed pack still decides the L1 (final review)', async () => {
    const driver = nodeSqliteDriver()
    const env = testEnv()
    const client = await Client.open({ driver, env, l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    await client.updateSettings({ l1: 'de' })
    expect(await client.changeL1('de', manifest, () => Promise.reject(new Error('offline')))).toEqual({ ok: false, reason: 'unavailable' })

    const reopened = await Client.open({ driver, env, l1: 'bg' })
    expect(reopened.snapshot.settings.l1).toBe('de')
    expect(reopened.snapshot.l1).toBe('bg')
    expect(reopened.snapshot.corpus?.l1).toBe('bg')
    expect(reopened.l1).toBe('bg')

    // A report is about the Bulgarian words the learner sees.
    const key = await reopened.report({ wordId: 'c:hello-1', field: 'translation', note: '', packVersion: 0 })
    expect((await reopened.reports()).find((r) => r.key === key)?.l1).toBe('bg')

    // Pack checks keep serving Bulgarian, and a staged Bulgarian upgrade is activated, not dropped.
    const next = await nextBgVersion(env)
    expect((await reopened.installPacks(next.manifest, next.fetch)).staged).toEqual(['corpus-bg'])
    expect(await reopened.startSession()).toEqual(['corpus-bg'])
    expect(reopened.snapshot.packVersion).toBe(1)

    // Once online, the pending change goes through.
    expect(await reopened.changeL1('de', manifest, fromDisk)).toEqual({ ok: true })
    expect(reopened.snapshot.l1).toBe('de')
    expect(reopened.snapshot.corpus?.l1).toBe('de')
  })

  it('a demo installed in German stays German when reopened with another default L1 (final review)', async () => {
    const driver = nodeSqliteDriver()
    const env = testEnv()
    const demo = await Client.open({ driver, env, l1: 'de' })
    await demo.installPacks(manifest, fromDisk)
    await demo.startSession()
    expect(demo.snapshot.corpus?.l1).toBe('de')

    // The interface language changed to Bulgarian, so boot's default is now 'bg'.
    const reopened = await Client.open({ driver, env, l1: 'bg' })
    expect(reopened.snapshot.l1).toBe('de')
    await reopened.installPacks(manifest, fromDisk)
    expect(await reopened.startSession()).toEqual([])
    expect(reopened.snapshot.l1).toBe('de')
    expect(reopened.snapshot.corpus?.l1).toBe('de')
  })

  it('installs the first pack, the default L1, even though l1 already equals it (setup’s Language step)', async () => {
    const driver = nodeSqliteDriver()
    const client = await Client.open({ driver, env: testEnv(), l1: 'bg' })
    expect(client.snapshot.corpus).toBeNull()
    let calls = 0
    const counting: PackFetcher = async (d) => {
      calls += 1
      return fromDisk(d)
    }

    expect(await client.changeL1('bg', manifest, counting)).toEqual({ ok: true })

    expect(client.snapshot.corpus?.l1).toBe('bg')
    expect(calls).toBe(1)
  })

  it('installs the first pack in the settings L1', async () => {
    const driver = nodeSqliteDriver()
    const client = await Client.open({ driver, env: testEnv(), l1: 'bg' })
    await client.updateSettings({ l1: 'de' })

    expect(await client.changeL1('de', manifest, fromDisk)).toEqual({ ok: true })

    expect(client.snapshot.corpus?.l1).toBe('de')
  })

  it('does nothing, and never fetches, when the active corpus is already in l1', async () => {
    const client = await openClient()
    let calls = 0
    const counting: PackFetcher = async (d) => {
      calls += 1
      return fromDisk(d)
    }

    expect(await client.changeL1('bg', manifest, counting)).toEqual({ ok: true })

    expect(calls).toBe(0)
  })
})

describe('levelClips (spec §9.3)', () => {
  it('lists every clip of the live words of a level', async () => {
    const client = await openClient()
    const clips = client.levelClips('A1')
    expect(clips.length).toBeGreaterThan(0)
    expect(new Set(clips.map((c) => c.clipId)).size).toBe(clips.length)
    expect(client.levelClips('B2')).toEqual([])
  })
})

describe('accountIsEmpty (spec §8.6)', () => {
  it('is true for an account with nothing the learner wrote, and false once it has', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    expect(await accountIsEmpty(server, 'demo-device')).toBe(true)
    const other = await openClient(env, server)
    await other.answer(answer('c:hello-1'))
    await other.sync()
    expect(await accountIsEmpty(server, 'demo-device')).toBe(false)
  })

  it('counts a settings document as progress, but not a server-owned one', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    // The fake keys documents `${type}/${key}`, as its own push does.
    server.documents.set('entitlement/', {
      type: 'entitlement', key: '', class: 'server_owned', version: 1,
      fields: { tier: 'free', source: 'default', expiresAt: null, quotas: { enrichmentPerDay: 20 } },
      fieldVersions: {}, deleted: false, staleAfter: null,
    })
    expect(await accountIsEmpty(server, 'demo-device')).toBe(true)
    const other = await openClient(env, server)
    await other.updateSettings({ newWordLimit: 3 })
    await other.sync()
    expect(await accountIsEmpty(server, 'demo-device')).toBe(false)
  })

  it('throws UpgradeRequiredError when the server refuses this build', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now, minProtocolVersion: 99 })
    await expect(accountIsEmpty(server, 'demo-device')).rejects.toBeInstanceOf(UpgradeRequiredError)
  })
})
