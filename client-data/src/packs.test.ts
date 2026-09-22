import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, type Pack, type PackDescriptor, type PackManifest } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import { activateStagedPacks, installedPacks, installPacks, loadActiveCorpus, type PackFetcher } from './packs'
import { migrate } from './schema'
import { testEnv } from './testing/testEnv'

const SAMPLE_DIR = fileURLToPath(new URL('../../pipeline/samples/a1-bg/', import.meta.url))
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
    const report = await installPacks(db, env, manifest, 'bg', fromDisk)
    expect(report).toEqual({ staged: ['corpus-bg'], appUpdateNeeded: [], rejected: [] })
    expect(await loadActiveCorpus(db)).toBeNull()
    expect(await activateStagedPacks(db)).toEqual(['corpus-bg'])
    expect(await activateStagedPacks(db)).toEqual([])
    const corpus = await loadActiveCorpus(db)
    expect(corpus?.entries.size).toBe(60)
    expect(await installedPacks(db)).toEqual([{ pack_id: 'corpus-bg', corpus_version: 0, schema_version: 1 }])
  })

  it('does not fetch what is already installed, staged or active', async () => {
    const { db, env } = await open()
    await installPacks(db, env, manifest, 'bg', fromDisk)
    let fetched = 0
    const counting: PackFetcher = (d) => {
      fetched += 1
      return fromDisk(d)
    }
    expect((await installPacks(db, env, manifest, 'bg', counting)).staged).toEqual([])
    await activateStagedPacks(db)
    expect((await installPacks(db, env, manifest, 'bg', counting)).staged).toEqual([])
    expect(fetched).toBe(0)
  })

  it('stages a newer version beside the active one; the session keeps the old one until activation', async () => {
    const { db, env } = await open()
    await installPacks(db, env, manifest, 'bg', fromDisk)
    await activateStagedPacks(db)
    const next = await nextVersion(env)
    expect((await installPacks(db, env, next.manifest, 'bg', next.fetch)).staged).toEqual(['corpus-bg'])
    expect(await installedPacks(db)).toEqual([{ pack_id: 'corpus-bg', corpus_version: 1, schema_version: 1 }])
    expect((await loadActiveCorpus(db))?.entries.size).toBe(60)
    expect(await db.all("SELECT status, corpus_version FROM pack ORDER BY status")).toEqual([
      { status: 'active', corpus_version: 0 },
      { status: 'staged', corpus_version: 1 },
    ])
    await activateStagedPacks(db)
    expect(await db.all('SELECT status, corpus_version FROM pack')).toEqual([{ status: 'active', corpus_version: 1 }])
  })

  it('rejects bytes that do not match the manifest, before parsing them', async () => {
    const { db, env } = await open()
    const short: PackFetcher = async (d) => (await fromDisk(d)).slice(0, 100)
    expect((await installPacks(db, env, manifest, 'bg', short)).rejected[0]?.reason).toMatch(/size/)
    const tampered: PackFetcher = async (d) => {
      const bytes = await fromDisk(d)
      bytes[10] = bytes[10]! ^ 1
      return bytes
    }
    expect((await installPacks(db, env, manifest, 'bg', tampered)).rejected[0]?.reason).toMatch(/checksum/)
    const wrongHash = { ...manifest, packs: [{ ...manifest.packs[0]!, sha256: 'a'.repeat(64) }] }
    expect((await installPacks(db, env, wrongHash, 'bg', fromDisk)).rejected[0]?.reason).toMatch(/checksum/)
    expect(await installedPacks(db)).toEqual([])
  })

  it('rejects a pack that describes itself differently from the manifest', async () => {
    const { db, env } = await open()
    const next = await nextVersion(env)
    const lying = { ...next.manifest, packs: [{ ...next.manifest.packs[0]!, corpus_version: 2 }] }
    const report = await installPacks(db, env, lying, 'bg', next.fetch)
    expect(report.rejected[0]?.reason).toMatch(/manifest/)
  })

  it('keeps the installed pack and reports an app update when the schema is newer', async () => {
    const { db, env } = await open()
    await installPacks(db, env, manifest, 'bg', fromDisk)
    await activateStagedPacks(db)
    const newer = { ...manifest, corpus_version: 2, packs: [{ ...manifest.packs[0]!, corpus_version: 2, schema_version: 2 }] }
    const report = await installPacks(db, env, newer, 'bg', fromDisk)
    expect(report.staged).toEqual([])
    expect(report.appUpdateNeeded.map((d) => d.corpus_version)).toEqual([2])
    expect((await loadActiveCorpus(db))?.entries.size).toBe(60)
  })

  it('ignores packs for another L1', async () => {
    const { db, env } = await open()
    const report = await installPacks(db, env, manifest, 'es', fromDisk)
    expect(report).toEqual({ staged: [], appUpdateNeeded: [], rejected: [] })
  })
})
