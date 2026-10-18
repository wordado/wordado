import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, loadCorpus, type CefrLevel, type Corpus, type Pack, type PackDescriptor, type PackManifest } from '@wordado/core'
import { Client } from '../client'
import { nodeSqliteDriver } from '../drivers/nodeSqlite'
import type { PackFetcher } from '../packs'
import { testEnv, type TestEnv } from './testEnv'

/**
 * The bundled A1 Bulgarian sample (plan 3). Node only. Built from the string
 * form of import.meta.url: happy-dom replaces the global URL class.
 */
export const SAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'pipeline', 'samples', 'a1')

export const sampleManifest = JSON.parse(readFileSync(join(SAMPLE_DIR, 'manifest.json'), 'utf8')) as PackManifest

export const sampleFetcher: PackFetcher = async (d) => new Uint8Array(readFileSync(join(SAMPLE_DIR, d.url)))

/** A demo client over an in-memory database with the sample active. */
export async function openSampleClient(env: TestEnv = testEnv()): Promise<Client> {
  const client = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg' })
  await client.installPacks(sampleManifest, sampleFetcher)
  await client.startSession()
  return client
}

/**
 * The sample with its entries spread across `levels` in equal runs, in the
 * order the corpus lists them. The sample is all A1; the placement test needs
 * bands, and nothing else about the entries changes.
 */
export function leveledCorpus(corpus: Corpus, levels: readonly CefrLevel[]): Corpus {
  const entries = [...corpus.entries.values()]
  const per = Math.ceil(entries.length / levels.length)
  return {
    ...corpus,
    entries: new Map(entries.map((entry, i) => [entry.entryId, { ...entry, level: levels[Math.floor(i / per)]! }])),
  }
}

/** Eight made-up probe words per level: a trial pack's test words (spec 2026-10-12 §3.1). */
export function trialProbes(levels: readonly CefrLevel[]): { entry_id: string; headword: string; pos: 'noun'; sense: string; level: CefrLevel; translation: string }[] {
  return levels.flatMap((level) =>
    Array.from({ length: 8 }, (_, i) => ({
      entry_id: `probe-${level.toLowerCase()}-${i}`,
      headword: `probe${level}${i}`,
      pos: 'noun' as const,
      sense: '',
      level,
      translation: `изпит ${level} ${i}`,
    })),
  )
}

/**
 * The sample as a trial: its units relabelled one per level (in order, entries with them), plus probes for
 * `probeLevels`. The pack is what a client installs; nothing else about it changes.
 */
export interface OpenThemeOptions {
  /** A theme the trial opens whole (#290). */
  readonly openTheme?: string
  /** With `openTheme`: the level whose unit the pack keeps; default the last of the unit levels. */
  readonly declared?: CefrLevel
}

/**
 * With `options.openTheme` the pack is cut as the pipeline cuts it (#290): the unit of the declared level only, its
 * entries and every entry tagged with the theme (each with its own `unit_id`), and the clips they name.
 */
export function trialPack(unitLevels: readonly CefrLevel[], probeLevels: readonly CefrLevel[] = unitLevels, options: OpenThemeOptions = {}): Pack {
  const pack = JSON.parse(readFileSync(join(SAMPLE_DIR, 'corpus-v0-bg.pack'), 'utf8')) as Pack
  const levelOf = new Map(pack.units.map((u, i) => [u.unit_id, unitLevels[i]!]))
  const relabelled = {
    ...pack,
    entries: pack.entries.map((e) => ({ ...e, level: levelOf.get(e.unit_id)! })),
    units: pack.units.map((u) => ({ ...u, level: levelOf.get(u.unit_id)! })),
    trial: { probes: trialProbes(probeLevels), course: { A1: { units: 10, words: 200 }, B1: { units: 12, words: 300 } }, themes: { 'daily-life': 240, travel: 1 } },
  }
  const { openTheme } = options
  if (openTheme === undefined) return relabelled
  const declared = options.declared ?? unitLevels.at(-1)!
  const units = relabelled.units.filter((u) => u.level === declared)
  const kept = new Set(units.map((u) => u.unit_id))
  const entries = relabelled.entries.filter((e) => kept.has(e.unit_id) || e.themes.includes(openTheme))
  const clips = new Set(entries.flatMap((e) => Object.values(e.audio)))
  return { ...relabelled, units, entries, audio: relabelled.audio.filter((c) => clips.has(c.clip_id)), trial: { ...relabelled.trial, open_theme: openTheme } }
}

/**
 * `pack` cut to its first unit, one version on: the trial pack a device that began on the whole sample installs
 * over it, which lacks words that device has answered (spec 2026-10-12 §4.6).
 */
export function firstUnitOnly(pack: Pack): Pack {
  const unit = pack.units[0]!
  const entries = pack.entries.filter((e) => e.unit_id === unit.unit_id)
  const clips = new Set(entries.flatMap((e) => Object.values(e.audio)))
  return { ...pack, corpus_version: pack.corpus_version + 1, units: [unit], entries, audio: pack.audio.filter((c) => clips.has(c.clip_id)) }
}

/** A manifest and fetcher serving `pack`, at its own version, in place of the sample's Bulgarian pack. */
export async function packServing(pack: Pack, env: TestEnv): Promise<{ manifest: PackManifest; fetch: PackFetcher }> {
  const bytes = new TextEncoder().encode(canonicalJson(pack))
  const descriptor: PackDescriptor = { ...sampleManifest.packs[0]!, corpus_version: pack.corpus_version, sha256: await env.sha256(bytes), bytes: bytes.byteLength }
  return { manifest: { ...sampleManifest, corpus_version: pack.corpus_version, packs: [descriptor] }, fetch: async () => bytes }
}

/** A client on the sample as a trial. */
export async function openTrialClient(unitLevels: readonly CefrLevel[], env: TestEnv = testEnv(), declaredLevel?: CefrLevel, options: Pick<OpenThemeOptions, 'openTheme'> = {}): Promise<Client> {
  const client = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg' })
  const served = await packServing(trialPack(unitLevels, unitLevels, declaredLevel === undefined ? options : { ...options, declared: declaredLevel }), env)
  await client.installPacks(served.manifest, served.fetch)
  await client.startSession()
  if (declaredLevel) await client.updateSettings({ declaredLevel })
  return client
}

/** `trialPack` as a loaded corpus, for tests that need no client. */
export function trialCorpus(unitLevels: readonly CefrLevel[], probeLevels: readonly CefrLevel[] = unitLevels, options: OpenThemeOptions = {}): Corpus {
  return loadCorpus([trialPack(unitLevels, probeLevels, options)])
}
