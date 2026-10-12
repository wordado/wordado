import {
  canonicalJson,
  CEFR_LEVELS,
  levelIndex,
  MIN_THEME_SIZE,
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
  // The themes the course offers, by its own rule, with their sizes: the trial shows them and studies none (#244).
  const themeWords = new Map<string, number>()
  for (const e of pack.entries) if (!e.retired) for (const id of e.themes) themeWords.set(id, (themeWords.get(id) ?? 0) + 1)
  const themes: Record<string, number> = {}
  for (const t of pack.themes) if ((themeWords.get(t.theme_id) ?? 0) >= MIN_THEME_SIZE) themes[t.theme_id] = themeWords.get(t.theme_id)!
  const themeIds = new Set([...entries.flatMap((e) => e.themes), ...Object.keys(themes)])
  const clipIds = new Set(entries.flatMap((e) => Object.values(e.audio)))
  const candidate: Pack = {
    ...pack,
    entries: entries.sort((a, b) => byString(a.entry_id, b.entry_id)),
    units: units.sort((a, b) => a.order - b.order),
    themes: pack.themes.filter((t) => themeIds.has(t.theme_id)).sort((a, b) => byString(a.theme_id, b.theme_id)),
    audio: pack.audio.filter((c) => clipIds.has(c.clip_id)).sort((a, b) => byString(a.clip_id, b.clip_id)),
    trial: { probes, course, themes },
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

/**
 * A release's trial for one course pack, with what stands in its way; the caller prefixes the lines (`<l1>: trial: `).
 * A trial that cannot be built is one of those problems, `<path>: <message>`, and gives no trial: left to throw, it
 * would read as a fault of the course pack.
 */
export function planTrial(pack: Pack, probesPerLevel: number): { trial: TrialOutput | null; problems: string[] } {
  let trial: TrialOutput
  try {
    trial = buildTrial(pack, probesPerLevel)
  } catch (err) {
    if (!(err instanceof BuildError)) throw err
    return { trial: null, problems: err.errors.map((e) => `${e.path || '(pack)'}: ${e.message}`) }
  }
  return { trial, problems: trialProblems(pack, trial.pack) }
}
