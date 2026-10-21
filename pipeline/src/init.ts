import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pack, PackManifest, Target } from '@wordado/core'
import { contentPaths } from './content'
import { readJson, writeJson } from './files'
import { PROFILES } from './profiles'
import { registryFromSample } from './registry'

export const SAMPLE_DIR = fileURLToPath(new URL('../samples/a1/', import.meta.url))
export const TEMPLATE_DIR = fileURLToPath(new URL('../template/', import.meta.url))

/**
 * A new content repository (Decision 2): the template's files, the sample's
 * IDs pinned in the registry, its curated themes named in English and
 * Bulgarian, and the sample itself as the last published version (v0).
 * The first real release is checked against it.
 *
 * Another target (spec §5.5) is a whole corpus of its own: the English sample
 * is no predecessor of it, so it starts with an empty registry, nothing
 * published, its own L1s and its language's first accent.
 */
export function initContent(dir: string, options: { target?: Target } = {}): void {
  if (existsSync(dir) && readdirSync(dir).some((f) => f !== '.git')) throw new Error(`${dir} is not empty`)
  const paths = contentPaths(dir)
  cpSync(TEMPLATE_DIR, dir, { recursive: true })
  const target = options.target ?? 'en'
  if (target !== 'en') return initOtherTarget(dir, target)
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

function initOtherTarget(dir: string, target: Target): void {
  const paths = contentPaths(dir)
  const profile = PROFILES[target]
  const config = readJson<Record<string, any>>(paths.config)
  const voice = Object.values(config.tts.accents as Record<string, any>)[0]
  const instructions = `Say the ${profile.name} word or phrase once, clearly and naturally, in standard ${profile.name}. Nothing else.`
  const accent = {
    ...voice,
    instructions,
    ...(voice.provider_options ? { provider_options: { 'google-ai-studio': { speech_metadata: { style: instructions } } } } : {}),
  }
  writeJson(paths.config, {
    ...config,
    target,
    l1s: (config.l1s as string[]).filter((l) => l !== target),
    tts: { ...config.tts, accents: { [profile.accents[0]!]: accent } },
  })
  // The curated themes are concepts, named in English and the L1s, so they carry over.
  const pack = JSON.parse(readFileSync(join(SAMPLE_DIR, 'corpus-v0-bg.pack'), 'utf8')) as Pack
  writeJson(paths.themes, pack.themes.map((t) => ({ theme_id: t.theme_id, name: { en: t.name.en, bg: t.name.l1 }, description: { en: t.description.en, bg: t.description.l1 } })))
  writeJson(paths.registry, { entries: [], units: [] })
  // The template's essentials are English headwords; the language writes its own list under the same header.
  const essentials = readFileSync(paths.essentials, 'utf8').split('\n')
  const header = essentials.slice(0, essentials.findIndex((l) => !l.startsWith('#')))
  writeFileSync(paths.essentials, `${header.join('\n')}\n`)
  mkdirSync(paths.lastPublished, { recursive: true })
  writeJson(join(paths.lastPublished, 'manifest.json'), { schema_version: 1, corpus_version: 0, packs: [] })
  writeJson(join(paths.lastPublished, 'fixes.json'), { schema_version: 1, corpus_version: 0, fixes: [] })
}
