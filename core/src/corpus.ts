import type { Pack } from './pack'
import { levelIndex, type CorpusEntry, type LocalizedText, type Unit } from './types'
import { corpusWordId, type WordId } from './wordId'

/** A theme is offered once this many live entries carry its tag (spec §8.9). Tuning value (§15). */
export const MIN_THEME_SIZE = 25

export interface Theme {
  readonly themeId: string
  readonly name: LocalizedText
  readonly description: LocalizedText
}

export interface AudioClip {
  readonly clipId: string
  /** Relative to the manifest that listed the pack (spec §9.3). */
  readonly url: string
  readonly sha256: string
  readonly bytes: number
  readonly mime: string
}

/** Every loaded pack, merged: what `PathContext`, `DistractorContext` and the screens read. */
export interface Corpus {
  readonly l1: string
  readonly entries: ReadonlyMap<string, CorpusEntry>
  /** In path order. */
  readonly units: readonly Unit[]
  /** The curated list, whether or not each theme is offered yet. */
  readonly themes: readonly Theme[]
  readonly clips: ReadonlyMap<string, AudioClip>
  /** For `PathContext.retired`. */
  readonly retired: ReadonlySet<WordId>
}

/**
 * Merges validated packs — the manifest's list (spec §5.1) — into one corpus.
 * Throws on what only a list can get wrong: an entry, unit, clip or unit
 * order in two packs, or packs for two L1s.
 */
export function loadCorpus(packs: readonly Pack[]): Corpus {
  const first = packs[0]
  if (!first) throw new Error('No packs to load')
  const entries = new Map<string, CorpusEntry>()
  const units: Unit[] = []
  const themes = new Map<string, Theme>()
  const clips = new Map<string, AudioClip>()
  const retired = new Set<WordId>()
  for (const pack of packs) {
    if (pack.l1 !== first.l1) throw new Error(`Pack ${pack.pack_id} is for L1 ${pack.l1}, not ${first.l1}`)
    for (const e of pack.entries) {
      if (entries.has(e.entry_id)) throw new Error(`Entry ${e.entry_id} appears in more than one pack`)
      entries.set(e.entry_id, {
        entryId: e.entry_id,
        headword: e.headword,
        variants: e.variants,
        pos: e.pos,
        sense: e.sense,
        level: e.level,
        ipa: e.ipa,
        unitId: e.unit_id,
        themes: e.themes,
        translations: [e.translation, ...e.alternates],
        examples: e.examples,
        audio: e.audio,
        retired: e.retired,
      })
      if (e.retired) retired.add(corpusWordId(e.entry_id))
    }
    for (const u of pack.units) {
      const clash = units.find((x) => x.unitId === u.unit_id || x.order === u.order)
      if (clash) throw new Error(`Unit ${u.unit_id} (order ${u.order}) clashes with unit ${clash.unitId} (order ${clash.order}) of another pack`)
      units.push({ unitId: u.unit_id, level: u.level, order: u.order, title: u.title, wordIds: u.entry_ids.map(corpusWordId) })
    }
    for (const t of pack.themes) {
      if (!themes.has(t.theme_id)) themes.set(t.theme_id, { themeId: t.theme_id, name: t.name, description: t.description })
    }
    for (const c of pack.audio) {
      if (clips.has(c.clip_id)) throw new Error(`Clip ${c.clip_id} appears in more than one pack`)
      clips.set(c.clip_id, { clipId: c.clip_id, url: c.url, sha256: c.sha256, bytes: c.bytes, mime: c.mime })
    }
  }
  units.sort((a, b) => a.order - b.order)
  return { l1: first.l1, entries, units, themes: [...themes.values()], clips, retired }
}

/** Each word's position along the path, for stable ordering inside a level. */
function pathPositions(corpus: Corpus): Map<WordId, number> {
  const positions = new Map<WordId, number>()
  for (const unit of corpus.units) for (const wordId of unit.wordIds) positions.set(wordId, positions.size)
  return positions
}

/**
 * The live entries of a theme in level order, then path order: the serve
 * order of a theme collection (spec §8.9), which plan 4 passes as
 * `SessionInput.collectionNew`.
 */
export function themeEntries(corpus: Corpus, themeId: string): CorpusEntry[] {
  const positions = pathPositions(corpus)
  const position = (e: CorpusEntry) => positions.get(corpusWordId(e.entryId)) ?? Number.MAX_SAFE_INTEGER
  return [...corpus.entries.values()]
    .filter((e) => !e.retired && e.themes.includes(themeId))
    .sort((a, b) => levelIndex(a.level) - levelIndex(b.level) || position(a) - position(b))
}

/** The themes big enough to offer (spec §8.9). A theme appears as the corpus grows; nothing is stored. */
export function offeredThemes(corpus: Corpus): Theme[] {
  return corpus.themes.filter((t) => themeEntries(corpus, t.themeId).length >= MIN_THEME_SIZE)
}

/** The clips an entry can play, UK first: what the audio prefetch and mode availability look at (spec §9.3). */
export function entryClips(corpus: Corpus, entry: CorpusEntry): AudioClip[] {
  return [entry.audio.uk, entry.audio.us].flatMap((id) => {
    const clip = id === undefined ? undefined : corpus.clips.get(id)
    return clip ? [clip] : []
  })
}
