import {
  canonicalJson,
  CEFR_LEVELS,
  levelIndex,
  seededRng,
  shuffle,
  validatePack,
  type CefrLevel,
  type Pack,
  type PackCourseSize,
  type PackDescriptor,
  type PackEntry,
  type PackProbe,
} from '@wordado/core'
import { BuildError } from './build'
import { sha256Hex } from './checksum'

/** Placement-test words per level (spec 2026-10-12 §3); `trial.probes_per_level` in pipeline.json overrides it. */
export const TRIAL_PROBES_PER_LEVEL = 40
export const TRIAL_MANIFEST = 'trial-manifest.json'

export interface TrialOutput {
  readonly pack: Pack
  /** `trial-v<version>-<l1>.trial`: the file the trial manifest points at. */
  readonly packFile: string
  readonly packBytes: Uint8Array
  /** For the trial manifest: the course's `pack_id`, this file's checksum. */
  readonly descriptor: PackDescriptor
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const probeOf = (e: PackEntry): PackProbe => ({
  entry_id: e.entry_id,
  headword: e.headword,
  pos: e.pos,
  sense: e.sense,
  level: e.level,
  translation: e.translation,
})

/**
 * The trial pack of a built course pack (spec 2026-10-12 §3). Pure: the same pack gives the same bytes. It holds
 * the first unit of every level that has one, and a seeded draw of each level's live words for the test.
 */
export function buildTrial(pack: Pack, probesPerLevel: number): TrialOutput {
  const entryById = new Map(pack.entries.map((e) => [e.entry_id, e]))
  const liveOf = (ids: readonly string[]): PackEntry[] =>
    ids.map((id) => entryById.get(id)).filter((e): e is PackEntry => e !== undefined && !e.retired)

  const units = []
  const probes: PackProbe[] = []
  const course: Partial<Record<CefrLevel, PackCourseSize>> = {}
  for (const level of CEFR_LEVELS) {
    const live = pack.units
      .filter((u) => u.level === level)
      .map((u) => ({ unit: u, live: liveOf(u.entry_ids) }))
      .filter((u) => u.live.length > 0)
      .sort((a, b) => a.unit.order - b.unit.order)
    if (live.length === 0) continue
    units.push(live[0]!.unit)
    // Sorted before the shuffle, so the draw depends on the words and the seed, not on the pack's order.
    const words = live.flatMap((u) => u.live).sort((a, b) => byString(a.entry_id, b.entry_id))
    const drawn = shuffle(words, seededRng(pack.corpus_version * 100 + levelIndex(level))).slice(0, probesPerLevel)
    probes.push(...drawn.sort((a, b) => byString(a.entry_id, b.entry_id)).map(probeOf))
    course[level] = { units: live.length, words: words.length }
  }

  // Retired entries of the first units travel too: a learner's old answers may name them.
  const entries = units.flatMap((u) => u.entry_ids.map((id) => entryById.get(id))).filter((e): e is PackEntry => e !== undefined)
  const themeIds = new Set(entries.flatMap((e) => e.themes))
  const clipIds = new Set(entries.flatMap((e) => Object.values(e.audio)))
  const candidate: Pack = {
    ...pack,
    entries: entries.sort((a, b) => byString(a.entry_id, b.entry_id)),
    units: units.sort((a, b) => a.order - b.order),
    themes: pack.themes.filter((t) => themeIds.has(t.theme_id)).sort((a, b) => byString(a.theme_id, b.theme_id)),
    audio: pack.audio.filter((c) => clipIds.has(c.clip_id)),
    trial: { probes, course },
  }
  const result = validatePack(JSON.parse(canonicalJson(candidate)))
  if (result.status !== 'ok') {
    throw new BuildError(result.status === 'invalid' ? result.errors : [{ path: 'schema_version', message: 'not supported by this build' }])
  }
  const packBytes = new TextEncoder().encode(canonicalJson(candidate))
  const packFile = `trial-v${pack.corpus_version}-${pack.l1}.trial`
  return {
    pack: candidate,
    packFile,
    packBytes,
    descriptor: {
      pack_id: pack.pack_id,
      l1: pack.l1,
      corpus_version: pack.corpus_version,
      schema_version: pack.schema_version,
      url: packFile,
      sha256: sha256Hex(packBytes),
      bytes: packBytes.byteLength,
    },
  }
}

/** What stands in the way: a level with a unit and no probes, an entry or clip that differs from the course's. */
export function trialProblems(course: Pack, trial: Pack): string[] {
  const p: string[] = []
  const probed = new Set((trial.trial?.probes ?? []).map((x) => x.level))
  for (const level of new Set(trial.units.map((u) => u.level))) {
    if (!probed.has(level)) p.push(`${level}: the trial has a unit and no probes`)
  }
  const entries = new Map(course.entries.map((e) => [e.entry_id, canonicalJson(e)]))
  for (const e of trial.entries) {
    if (entries.get(e.entry_id) !== canonicalJson(e)) p.push(`${e.entry_id}: differs from the course's entry`)
  }
  const clips = new Map(course.audio.map((c) => [c.clip_id, canonicalJson(c)]))
  for (const c of trial.audio) {
    if (clips.get(c.clip_id) !== canonicalJson(c)) p.push(`${c.clip_id}: differs from the course's clip`)
  }
  return p
}
