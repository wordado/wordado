import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Grade, type PackManifest } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Client, ClientClosed } from './client'
import type { SqlDriver } from './driver'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import type { AnswerInput } from './learner'
import type { PackFetcher } from './packs'
import { accountIsEmpty, UpgradeRequiredError } from './sync'
import { FakeServer } from './testing/fakeServer'
import { testEnv, type TestEnv } from './testing/testEnv'

const SAMPLE_DIR = fileURLToPath(new URL('../../pipeline/samples/a1-bg/', import.meta.url))
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
