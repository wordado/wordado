import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, type L1, type Pack, type PackDescriptor, type PackManifest } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import { activateStagedPacks, installedPacks, installPacks, loadActiveCorpus, type PackFetcher } from './packs'
import { migrate } from './schema'
import { germanServing } from './testing/sample'
import { testEnv } from './testing/testEnv'

const SAMPLE_DIR = fileURLToPath(new URL('../../pipeline/samples/a1/', import.meta.url))
const manifest = JSON.parse(readFileSync(join(SAMPLE_DIR, 'manifest.json'), 'utf8')) as PackManifest
const fromDisk: PackFetcher = async (d) => new Uint8Array(readFileSync(join(SAMPLE_DIR, d.url)))

async function open() {
  const db = new Database(nodeSqliteDriver())
  await migrate(db)
  return { db, env: testEnv() }
}

/** The sample pack at a higher corpus version, with its manifest, as the CDN would serve it. */
async function nextVersion(env: ReturnType<typeof testEnv>): Promise<{ manifest: PackManifest; fetch: PackFetcher; bytes: Uint8Array }> {
  const pack = JSON.parse(readFileSync(join(SAMPLE_DIR, 'corpus-v0-bg.pack'), 'utf8')) as Pack
  const bytes = new TextEncoder().encode(canonicalJson({ ...pack, corpus_version: 1 }))
  const descriptor: PackDescriptor = { ...manifest.packs[0]!, corpus_version: 1, url: 'corpus-v1-bg.pack', sha256: await env.sha256(bytes), bytes: bytes.byteLength }
  return { manifest: { ...manifest, corpus_version: 1, packs: [descriptor] }, fetch: async () => bytes, bytes }
}

describe('installPacks', () => {
  it('stages the learner-L1 pack of a fresh install and activates it at the next session start', async () => {
    const { db, env } = await open()
    const report = await installPacks(db, env, manifest, { target: 'en', l1: 'bg' }, fromDisk)
    expect(report).toEqual({ staged: ['corpus-bg'], appUpdateNeeded: [], rejected: [] })
    expect(await loadActiveCorpus(db)).toBeNull()
    expect(await activateStagedPacks(db, { target: 'en', l1: 'bg' })).toEqual(['corpus-bg'])
    expect(await activateStagedPacks(db, { target: 'en', l1: 'bg' })).toEqual([])
    const corpus = await loadActiveCorpus(db)
    expect(corpus?.entries.size).toBe(60)
    expect(await installedPacks(db)).toEqual([{ pack_id: 'corpus-bg', corpus_version: 0, schema_version: 1 }])
  })

  it('does not fetch what is already installed, staged or active', async () => {
    const { db, env } = await open()
    await installPacks(db, env, manifest, { target: 'en', l1: 'bg' }, fromDisk)
    let fetched = 0
    const counting: PackFetcher = (d) => {
      fetched += 1
      return fromDisk(d)
    }
    expect((await installPacks(db, env, manifest, { target: 'en', l1: 'bg' }, counting)).staged).toEqual([])
    await activateStagedPacks(db, { target: 'en', l1: 'bg' })
    expect((await installPacks(db, env, manifest, { target: 'en', l1: 'bg' }, counting)).staged).toEqual([])
    expect(fetched).toBe(0)
  })

  it('stages a newer version beside the active one; the session keeps the old one until activation', async () => {
    const { db, env } = await open()
    await installPacks(db, env, manifest, { target: 'en', l1: 'bg' }, fromDisk)
    await activateStagedPacks(db, { target: 'en', l1: 'bg' })
    const next = await nextVersion(env)
    expect((await installPacks(db, env, next.manifest, { target: 'en', l1: 'bg' }, next.fetch)).staged).toEqual(['corpus-bg'])
    expect(await installedPacks(db)).toEqual([{ pack_id: 'corpus-bg', corpus_version: 1, schema_version: 1 }])
    expect((await loadActiveCorpus(db))?.entries.size).toBe(60)
    expect(await db.all("SELECT status, corpus_version FROM pack ORDER BY status")).toEqual([
      { status: 'active', corpus_version: 0 },
      { status: 'staged', corpus_version: 1 },
    ])
    await activateStagedPacks(db, { target: 'en', l1: 'bg' })
    expect(await db.all('SELECT status, corpus_version FROM pack')).toEqual([{ status: 'active', corpus_version: 1 }])
  })

  it('rejects bytes that do not match the manifest, before parsing them', async () => {
    const { db, env } = await open()
    const short: PackFetcher = async (d) => (await fromDisk(d)).slice(0, 100)
    expect((await installPacks(db, env, manifest, { target: 'en', l1: 'bg' }, short)).rejected[0]?.reason).toMatch(/size/)
    const tampered: PackFetcher = async (d) => {
      const bytes = await fromDisk(d)
      bytes[10] = bytes[10]! ^ 1
      return bytes
    }
    expect((await installPacks(db, env, manifest, { target: 'en', l1: 'bg' }, tampered)).rejected[0]?.reason).toMatch(/checksum/)
    const wrongHash = { ...manifest, packs: [{ ...manifest.packs[0]!, sha256: 'a'.repeat(64) }] }
    expect((await installPacks(db, env, wrongHash, { target: 'en', l1: 'bg' }, fromDisk)).rejected[0]?.reason).toMatch(/checksum/)
    expect(await installedPacks(db)).toEqual([])
  })

  it('rejects a pack that describes itself differently from the manifest', async () => {
    const { db, env } = await open()
    const next = await nextVersion(env)
    const lying = { ...next.manifest, packs: [{ ...next.manifest.packs[0]!, corpus_version: 2 }] }
    const report = await installPacks(db, env, lying, { target: 'en', l1: 'bg' }, next.fetch)
    expect(report.rejected[0]?.reason).toMatch(/manifest/)
  })

  it('keeps the installed pack and reports an app update when the schema is newer', async () => {
    const { db, env } = await open()
    await installPacks(db, env, manifest, { target: 'en', l1: 'bg' }, fromDisk)
    await activateStagedPacks(db, { target: 'en', l1: 'bg' })
    const newer = { ...manifest, corpus_version: 2, packs: [{ ...manifest.packs[0]!, corpus_version: 2, schema_version: 2 }] }
    const report = await installPacks(db, env, newer, { target: 'en', l1: 'bg' }, fromDisk)
    expect(report.staged).toEqual([])
    expect(report.appUpdateNeeded.map((d) => d.corpus_version)).toEqual([2])
    expect((await loadActiveCorpus(db))?.entries.size).toBe(60)
  })

  it('ignores packs for another L1', async () => {
    const { db, env } = await open()
    const report = await installPacks(db, env, manifest, { target: 'en', l1: 'fr' as L1 }, fromDisk)
    expect(report).toEqual({ staged: [], appUpdateNeeded: [], rejected: [] })
  })

  it('stages a different L1 beside the active one instead of rejecting it as a non-merging pack', async () => {
    const { db, env } = await open()
    await installPacks(db, env, manifest, { target: 'en', l1: 'bg' }, fromDisk)
    await activateStagedPacks(db, { target: 'en', l1: 'bg' })
    const report = await installPacks(db, env, manifest, { target: 'en', l1: 'de' }, fromDisk)
    expect(report).toEqual({ staged: ['corpus-de'], appUpdateNeeded: [], rejected: [] })
    expect(await db.all("SELECT pack_id, status FROM pack ORDER BY pack_id")).toEqual([
      { pack_id: 'corpus-bg', status: 'active' },
      { pack_id: 'corpus-de', status: 'staged' },
    ])
  })

  it('activateStagedPacks drops the other L1s active packs once the given L1 takes over', async () => {
    const { db, env } = await open()
    await installPacks(db, env, manifest, { target: 'en', l1: 'bg' }, fromDisk)
    await activateStagedPacks(db, { target: 'en', l1: 'bg' })
    await installPacks(db, env, manifest, { target: 'en', l1: 'de' }, fromDisk)
    expect(await activateStagedPacks(db, { target: 'en', l1: 'de' })).toEqual(['corpus-de'])
    expect(await db.all("SELECT pack_id, status FROM pack")).toEqual([{ pack_id: 'corpus-de', status: 'active' }])
  })

  it('activateStagedPacks scoped to bg never promotes a staged pack of another L1, and drops it instead (fix round 1)', async () => {
    const { db, env } = await open()
    await installPacks(db, env, manifest, { target: 'en', l1: 'bg' }, fromDisk)
    await activateStagedPacks(db, { target: 'en', l1: 'bg' })
    // A leftover from an earlier, interrupted `changeCourse({ target: 'en', l1: 'de' }, …)`: staged, never activated.
    await installPacks(db, env, manifest, { target: 'en', l1: 'de' }, fromDisk)
    expect(await db.all("SELECT pack_id, status FROM pack ORDER BY pack_id")).toEqual([
      { pack_id: 'corpus-bg', status: 'active' },
      { pack_id: 'corpus-de', status: 'staged' },
    ])
    expect(await activateStagedPacks(db, { target: 'en', l1: 'bg' })).toEqual([])
    expect(await db.all("SELECT pack_id, status FROM pack")).toEqual([{ pack_id: 'corpus-bg', status: 'active' }])
    expect((await loadActiveCorpus(db))?.l1).toBe('bg')
  })

  it('a newer pack of the old L1 staged beside a fresh install of the new one does not stop the new one taking over (fix round 1)', async () => {
    const { db, env } = await open()
    await installPacks(db, env, manifest, { target: 'en', l1: 'bg' }, fromDisk)
    await activateStagedPacks(db, { target: 'en', l1: 'bg' })
    // A background upgrade check staged a newer corpus-bg, never activated, right as the learner switches to German.
    const next = await nextVersion(env)
    await installPacks(db, env, next.manifest, { target: 'en', l1: 'bg' }, next.fetch)
    await installPacks(db, env, manifest, { target: 'en', l1: 'de' }, fromDisk)
    expect(await db.all("SELECT pack_id, status FROM pack ORDER BY pack_id")).toEqual([
      { pack_id: 'corpus-bg', status: 'active' },
      { pack_id: 'corpus-bg', status: 'staged' },
      { pack_id: 'corpus-de', status: 'staged' },
    ])
    expect(await activateStagedPacks(db, { target: 'en', l1: 'de' })).toEqual(['corpus-de'])
    expect(await db.all("SELECT pack_id, status FROM pack")).toEqual([{ pack_id: 'corpus-de', status: 'active' }])
    expect((await loadActiveCorpus(db))?.l1).toBe('de')
  })
})

describe('installPacks by course (spec §5.5, §8.6)', () => {
  it('activates one course at a time: German Bulgarian replaces English Bulgarian', async () => {
    const { db, env } = await open()
    const german = await germanServing(env)
    await installPacks(db, env, german.manifest, { target: 'en', l1: 'bg' }, german.fetch)
    await activateStagedPacks(db, { target: 'en', l1: 'bg' })
    expect((await installedPacks(db)).map((p) => p.pack_id)).toEqual(['corpus-bg'])
    await installPacks(db, env, german.manifest, { target: 'de', l1: 'bg' }, german.fetch)
    await activateStagedPacks(db, { target: 'de', l1: 'bg' })
    expect((await loadActiveCorpus(db))!.target).toBe('de')
    expect((await installedPacks(db)).map((p) => p.pack_id)).toEqual(['corpus-de-bg'])
  })

  it('fetches only the packs of the course asked for, from a manifest listing both', async () => {
    const { db, env } = await open()
    const german = await germanServing(env)
    expect((await installPacks(db, env, german.manifest, { target: 'de', l1: 'bg' }, german.fetch)).staged).toEqual(['corpus-de-bg'])
    expect((await installPacks(db, env, german.manifest, { target: 'en', l1: 'bg' }, german.fetch)).staged).toEqual(['corpus-bg'])
  })

  it('a staged pack of the other course of the same L1 is never promoted, and is dropped instead', async () => {
    const { db, env } = await open()
    const german = await germanServing(env)
    await installPacks(db, env, german.manifest, { target: 'en', l1: 'bg' }, german.fetch)
    await activateStagedPacks(db, { target: 'en', l1: 'bg' })
    await installPacks(db, env, german.manifest, { target: 'de', l1: 'bg' }, german.fetch)
    expect(await activateStagedPacks(db, { target: 'en', l1: 'bg' })).toEqual([])
    expect(await db.all('SELECT pack_id, status FROM pack')).toEqual([{ pack_id: 'corpus-bg', status: 'active' }])
    expect((await loadActiveCorpus(db))!.target).toBe('en')
  })

  it('refuses a pack whose target differs from its descriptor', async () => {
    const { db, env } = await open()
    const englishPackBytes = await fromDisk(manifest.packs[0]!)
    const manifestClaimingTarget = (target: string, bytes: Uint8Array): PackManifest => ({ ...manifest, packs: [{ ...manifest.packs[0]!, target, bytes: bytes.byteLength }] })
    const report = await installPacks(db, env, manifestClaimingTarget('de', englishPackBytes), { target: 'de', l1: 'bg' }, async () => englishPackBytes)
    expect(report.rejected[0]!.reason).toBe('the pack describes itself differently from the manifest')
  })
})
