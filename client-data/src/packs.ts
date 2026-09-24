import {
  loadCorpus,
  PACK_SCHEMA_VERSION,
  selectPacks,
  validatePack,
  type Corpus,
  type InstalledPack,
  type Pack,
  type PackDescriptor,
  type PackManifest,
} from '@wordado/core'
import type { Database } from './database'
import type { SqlDriver } from './driver'
import type { ClientEnv } from './env'

/** Fetches a pack's bytes; resolves `descriptor.url` against the manifest's URL (plan 3 contract). */
export type PackFetcher = (descriptor: PackDescriptor) => Promise<Uint8Array>

export interface InstallReport {
  readonly staged: readonly string[]
  /** Newer packs whose schema this build cannot read: the installed pack stays (spec §5.1). */
  readonly appUpdateNeeded: readonly PackDescriptor[]
  readonly rejected: readonly { readonly packId: string; readonly reason: string }[]
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

interface PackRow {
  pack_id: string
  corpus_version: number
  schema_version: number
}

/** What is installed, staged or active, highest version per pack, so nothing is fetched twice. */
export async function installedPacks(db: Database): Promise<InstalledPack[]> {
  const rows = await db.all<PackRow>('SELECT pack_id, corpus_version, schema_version FROM pack ORDER BY corpus_version')
  const best = new Map<string, InstalledPack>()
  for (const r of rows) best.set(r.pack_id, { pack_id: r.pack_id, corpus_version: r.corpus_version, schema_version: r.schema_version })
  return [...best.values()]
}

async function activePacks(driver: SqlDriver): Promise<Pack[]> {
  const rows = await driver.all<{ json: string }>("SELECT json FROM pack WHERE status = 'active' ORDER BY pack_id")
  return rows.map((r) => JSON.parse(r.json) as Pack)
}

/** Why a fetched pack cannot be staged, or null when it can. Verifies before it parses (plan 3 contract). */
async function checkFetched(
  env: ClientEnv,
  descriptor: PackDescriptor,
  bytes: Uint8Array,
  others: readonly Pack[],
): Promise<{ pack: Pack; text: string } | string> {
  if (bytes.byteLength !== descriptor.bytes) return `size ${bytes.byteLength} differs from the manifest's ${descriptor.bytes}`
  if ((await env.sha256(bytes)) !== descriptor.sha256) return 'checksum differs from the manifest'
  const text = new TextDecoder().decode(bytes)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return 'not JSON'
  }
  const result = validatePack(parsed)
  if (result.status === 'unsupported_schema') return `schema ${result.schemaVersion} is not supported`
  if (result.status === 'invalid') return `invalid: ${result.errors[0]?.path}: ${result.errors[0]?.message}`
  const pack = result.pack
  if (pack.pack_id !== descriptor.pack_id || pack.corpus_version !== descriptor.corpus_version || pack.l1 !== descriptor.l1) {
    return 'the pack describes itself differently from the manifest'
  }
  try {
    loadCorpus([...others.filter((p) => p.pack_id !== pack.pack_id), pack])
  } catch (err) {
    return `does not merge with the installed packs: ${messageOf(err)}`
  }
  return { pack, text }
}

/**
 * Fetches, verifies and stages the packs the manifest offers for `l1` and this
 * build can read (spec §5.1, §9.3). Staged packs become visible only through
 * `activateStagedPacks`, so a download never changes a running session.
 */
export async function installPacks(
  db: Database,
  env: ClientEnv,
  manifest: PackManifest,
  l1: string,
  fetchPack: PackFetcher,
): Promise<InstallReport> {
  const installed = await installedPacks(db)
  const selection = selectPacks({ manifest, l1, installed, supportedSchemaVersions: [PACK_SCHEMA_VERSION] })
  const others = await activePacks(db.driver)
  const staged: string[] = []
  const rejected: { packId: string; reason: string }[] = []
  for (const descriptor of selection.fetch) {
    let bytes: Uint8Array
    try {
      bytes = await fetchPack(descriptor)
    } catch (err) {
      rejected.push({ packId: descriptor.pack_id, reason: `fetch failed: ${messageOf(err)}` })
      continue
    }
    const checked = await checkFetched(env, descriptor, bytes, others)
    if (typeof checked === 'string') {
      rejected.push({ packId: descriptor.pack_id, reason: checked })
      continue
    }
    await db.transaction((tx) =>
      tx.run(
        `INSERT INTO pack (pack_id, status, corpus_version, schema_version, sha256, bytes, json)
         VALUES (?, 'staged', ?, ?, ?, ?, ?)
         ON CONFLICT (pack_id, status) DO UPDATE SET
           corpus_version = excluded.corpus_version, schema_version = excluded.schema_version,
           sha256 = excluded.sha256, bytes = excluded.bytes, json = excluded.json`,
        [descriptor.pack_id, checked.pack.corpus_version, checked.pack.schema_version, descriptor.sha256, descriptor.bytes, checked.text],
      ),
    )
    staged.push(descriptor.pack_id)
  }
  return { staged, appUpdateNeeded: selection.appUpdateNeeded, rejected }
}

/** Swaps staged packs in. Call at the start of a session, never in the middle of one (spec §5.1). */
export async function activateStagedPacks(db: Database): Promise<string[]> {
  return db.transaction(async (tx) => {
    const staged = await tx.all<{ pack_id: string }>("SELECT pack_id FROM pack WHERE status = 'staged' ORDER BY pack_id")
    for (const { pack_id } of staged) {
      await tx.run("DELETE FROM pack WHERE pack_id = ? AND status = 'active'", [pack_id])
      await tx.run("UPDATE pack SET status = 'active' WHERE pack_id = ? AND status = 'staged'", [pack_id])
    }
    return staged.map((s) => s.pack_id)
  })
}

/** The active packs as one corpus, or null before the first pack is activated. */
export async function loadActiveCorpus(db: Database): Promise<Corpus | null> {
  const packs = await activePacks(db.driver)
  return packs.length === 0 ? null : loadCorpus(packs)
}

/** The corpus version of the active packs (the highest, when there are several): what a content report cites (spec §8.10). */
export async function activePackVersion(db: Database): Promise<number | null> {
  const rows = await db.all<{ v: number | null }>("SELECT MAX(corpus_version) AS v FROM pack WHERE status = 'active'")
  return rows[0]?.v ?? null
}
