import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateManifest, validatePack, type Pack, type PackManifest, type ReportField } from '@wordado/core'
import { sha256Hex } from './checksum'
import { contentPaths } from './content'
import { readJsonOr } from './files'

/** One entry field that changed in a corpus version: what plan 8b matches a learner's reports against (spec §8.10). */
export interface Fix {
  readonly word_id: string
  readonly field: ReportField
  readonly fixed_in: number
}

export interface FixesFile {
  readonly schema_version: 1
  readonly corpus_version: number
  readonly fixes: readonly Fix[]
}

/** The corpus as last published: the predecessor every release is checked against (Decision 14). */
export interface LastPublished {
  readonly manifest: PackManifest
  /** By L1. */
  readonly packs: ReadonlyMap<string, Pack>
  /** The packs' bytes by file name, for `corpus live`. */
  readonly packBytes: ReadonlyMap<string, Uint8Array>
  readonly fixes: FixesFile
  /** Entries live in any published pack. */
  readonly live: ReadonlySet<string>
  /** Every entry any published pack carries, live or retired. */
  readonly published: ReadonlySet<string>
}

export function readLastPublished(dir: string): LastPublished {
  const root = contentPaths(dir).lastPublished
  const manifestFile = join(root, 'manifest.json')
  if (!existsSync(manifestFile)) throw new Error('last-published/manifest.json is missing; run `corpus init` or restore it from the CDN')
  const m = validateManifest(JSON.parse(readFileSync(manifestFile, 'utf8')))
  if (m.status !== 'ok') throw new Error(`last-published/manifest.json: ${m.status === 'invalid' ? m.errors.map((e) => `${e.path}: ${e.message}`).join('; ') : 'unsupported schema'}`)
  const packs = new Map<string, Pack>()
  const packBytes = new Map<string, Uint8Array>()
  for (const d of m.manifest.packs) {
    const file = join(root, d.url)
    if (!existsSync(file)) throw new Error(`last-published/${d.url}: missing`)
    const bytes = new Uint8Array(readFileSync(file))
    if (sha256Hex(bytes) !== d.sha256) throw new Error(`last-published/${d.url}: sha256 does not match the manifest`)
    const p = validatePack(JSON.parse(new TextDecoder().decode(bytes)))
    if (p.status !== 'ok') throw new Error(`last-published/${d.url}: not a valid pack`)
    packs.set(d.l1, p.pack)
    packBytes.set(d.url, bytes)
  }
  const live = new Set<string>()
  const published = new Set<string>()
  for (const pack of packs.values()) {
    for (const e of pack.entries) {
      published.add(e.entry_id)
      if (!e.retired) live.add(e.entry_id)
    }
  }
  const fixes = readJsonOr<FixesFile>(join(root, 'fixes.json'), { schema_version: 1, corpus_version: m.manifest.corpus_version, fixes: [] })
  return { manifest: m.manifest, packs, packBytes, fixes, live, published }
}
