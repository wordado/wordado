import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Grade, type PackManifest } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Client } from './client'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import type { AnswerInput } from './learner'
import type { PackFetcher } from './packs'
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
