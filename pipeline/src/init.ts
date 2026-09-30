import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pack, PackManifest } from '@wordado/core'
import { contentPaths } from './content'
import { writeJson } from './files'
import { registryFromSample } from './registry'

export const SAMPLE_DIR = fileURLToPath(new URL('../samples/a1/', import.meta.url))
export const TEMPLATE_DIR = fileURLToPath(new URL('../template/', import.meta.url))

/**
 * A new content repository (Decision 2): the template's files, the sample's
 * IDs pinned in the registry, its curated themes named in English and
 * Bulgarian, and the sample itself as the last published version (v0).
 * The first real release is checked against it.
 */
export function initContent(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).some((f) => f !== '.git')) throw new Error(`${dir} is not empty`)
  const paths = contentPaths(dir)
  cpSync(TEMPLATE_DIR, dir, { recursive: true })
  const packFile = 'corpus-v0-bg.pack'
  const pack = JSON.parse(readFileSync(join(SAMPLE_DIR, packFile), 'utf8')) as Pack
  writeJson(paths.registry, registryFromSample(pack))
  writeJson(
    paths.themes,
    pack.themes.map((t) => ({ theme_id: t.theme_id, name: { en: t.name.en, bg: t.name.l1 }, description: { en: t.description.en, bg: t.description.l1 } })),
  )
  mkdirSync(paths.lastPublished, { recursive: true })
  cpSync(join(SAMPLE_DIR, packFile), join(paths.lastPublished, packFile))
  // The sample's manifest lists every L1 it carries (plan 10); a new content directory starts from Bulgarian alone.
  const sampleManifest = JSON.parse(readFileSync(join(SAMPLE_DIR, 'manifest.json'), 'utf8')) as PackManifest
  writeJson(join(paths.lastPublished, 'manifest.json'), { ...sampleManifest, packs: sampleManifest.packs.filter((p) => p.l1 === 'bg') })
  writeJson(join(paths.lastPublished, 'fixes.json'), { schema_version: 1, corpus_version: 0, fixes: [] })
}
