import { existsSync, readFileSync } from 'node:fs'
import { norm, type CefrLevel, type LocalizedText, type PartOfSpeech } from '@wordado/core'
import { StageCache } from './cache'
import { readConfig, readThemes } from './config'
import { contentPaths } from './content'
import { Decisions, foldField, QUEUES } from './decisions'
import { readJson, writeJson } from './files'
import { parseFrequencyList, rankForms } from './frequency'
import { readLastPublished } from './lastPublished'
import type { Llm } from './llm'
import { assignIds, type Registry } from './registry'
import { selectLive } from './select'
import { readClearedSources } from './sources'
import { lemmatise, rankLemmas, type StageRun } from './stages/lemmas'
import { bandLevel, describeLemmas, frequencyBand } from './stages/senses'
import { titleUnits } from './stages/titles'
import { mergeSenses, translateSenses, type TranslationFields } from './stages/translate'
import { assignUnits } from './units'

export interface EnglishFields {
  readonly ipa: string
  readonly variants: readonly string[]
  readonly examples: readonly string[]
}

/** One candidate entry with its proposals: what the queues show and what a release folds decisions over. */
export interface DraftEntry {
  readonly entry_id: string
  readonly headword: string
  readonly pos: PartOfSpeech
  readonly sense_en: string
  readonly rank: number
  readonly order: number
  readonly pinned: boolean
  /** The first sense of a word in essentials.txt: live at the LLM's level whatever its frequency (Decision 19). */
  readonly essential: boolean
  readonly band: CefrLevel
  /** What the banding queue judges: the unit's level for a placed entry, else the banded LLM level. */
  readonly level_proposal: CefrLevel
  /** The proposal after any banding decision. */
  readonly level: CefrLevel
  /** The frequency band clamped the LLM's level (Decision 7). */
  readonly level_flagged: boolean
  readonly themes: readonly string[]
  readonly english: EnglishFields
  readonly l1: Readonly<Record<string, TranslationFields>>
}

export interface DraftUnit {
  readonly unit_id: string
  readonly level: CefrLevel
  readonly entry_ids: readonly string[]
  /** By L1; absent for a unit with no live entry. */
  readonly titles: Readonly<Record<string, LocalizedText>>
}

export interface Draft {
  readonly live: readonly string[]
  readonly entries: readonly DraftEntry[]
  readonly units: readonly DraftUnit[]
  /** What stops a release whatever the reviewers do. */
  readonly problems: readonly string[]
}

export interface DraftOptions {
  readonly dir: string
  readonly llm: Llm
  /** No LLM calls: every answer must be cached (the release workflow). */
  readonly offline: boolean
}

/** `corpus draft`: every LLM stage, then IDs, decisions, selection and units. Writes registry.json and work/draft.json. */
export async function runDraft(opts: DraftOptions): Promise<Draft> {
  const { dir, llm, offline } = opts
  const paths = contentPaths(dir)
  const config = readConfig(dir)
  const themes = readThemes(dir, config.l1s)
  const sources = readClearedSources(dir)
  const last = readLastPublished(dir)
  const decisions = Decisions.read(dir)
  let registry = readJson<Registry>(paths.registry)
  const run = (stage: string): StageRun => ({ llm, cache: StageCache.open(paths.cache(stage)), concurrency: config.llm.concurrency, offline })

  const forms = rankForms(sources.map((s) => parseFrequencyList(s.text, s.record.id)), config.max_forms)
  const lemmaResults = await lemmatise(forms, run('lemmas'))
  const essentials = new Set(readEssentials(dir))
  const pinnedHeadwords = [...registry.entries.filter((e) => e.pinned).map((e) => e.headword), ...essentials]
  // A published entry stays live unless a reviewer drops it (Decision 9), so neither a list refresh that pushes
  // its lemma past the cut nor a banded level outside the shipped ones may take it out of the draft.
  const published = registry.entries.filter((e) => last.live.has(e.entry_id))
  const publishedHeads = new Set(published.map((e) => `${norm(e.headword)}|${e.pos}`))
  const lemmas = rankLemmas(forms, lemmaResults, [...pinnedHeadwords, ...published.map((e) => e.headword)], config.max_lemmas)
  // rankLemmas marks a published lemma pinned too; only a sample or essential word passes the level check whole.
  const pinnedLemmas = new Set(pinnedHeadwords.map(norm))
  const senses = await describeLemmas(lemmas, themes.map((t) => t.theme_id), run('senses'))

  const inScope = lemmas.flatMap((lemma, i) =>
    senses[i]!.flatMap((s, order) => {
      const band = frequencyBand(lemma.rank, config.targets)
      // Only the first sense, the most common by the stage's instruction, is essential: essentials.txt guarantees
      // the everyday meaning of "bed", not the garden plot. Its frequency understates it, so its level is the LLM's
      // and a reviewer checks every one; the word's other senses compete by frequency like any word's.
      const essential = essentials.has(lemma.lemma) && order === 0
      const banded = essential ? { level: s.level === 'C2' ? null : s.level, flagged: true } : bandLevel(s.level, band)
      if (banded.level === null) return []
      // A published sense keeps its unit, and the unit's level is its proposal, whatever the banding says now.
      const wasPublished = publishedHeads.has(`${norm(s.headword)}|${s.pos}`)
      if (!pinnedLemmas.has(lemma.lemma) && !wasPublished && !config.levels.includes(banded.level)) return []
      return [{ ...s, rank: lemma.rank, order, band, essential, banded: banded.level, flagged: banded.flagged }]
    }),
  )
  const translations: Record<string, TranslationFields[]> = {}
  for (const l1 of config.l1s) {
    translations[l1] = await translateSenses(
      l1,
      inScope.map((s) => ({ headword: s.headword, pos: s.pos, gloss: s.gloss, example: s.examples[0]! })),
      run(`translate-${l1}`),
    )
  }
  const merged = mergeSenses(
    inScope.map((s, i) => ({ ...s, l1: Object.fromEntries(config.l1s.map((l) => [l, translations[l]![i]!])) as Record<string, TranslationFields> })),
    config.l1s,
  )

  const assigned = assignIds(registry, merged.map((s) => ({ headword: s.headword, pos: s.pos, sense_en: s.gloss })))
  registry = assigned.registry
  const pinned = new Set(registry.entries.filter((e) => e.pinned).map((e) => e.entry_id))
  const unitOf = new Map(registry.units.flatMap((u) => u.entry_ids.map((id) => [id, u] as const)))
  const entries: DraftEntry[] = merged.map((s, i) => {
    const entry_id = assigned.ids[i]!
    const unit = unitOf.get(entry_id)
    // An entry keeps its unit, and so its level, unless a banding decision moves it (Decision 9).
    const proposal = unit ? unit.level : s.banded
    return {
      entry_id,
      headword: s.headword,
      pos: s.pos,
      sense_en: s.gloss,
      rank: s.rank,
      order: s.order,
      pinned: pinned.has(entry_id),
      essential: s.essential,
      band: s.band,
      level_proposal: proposal,
      level: foldField(proposal, decisions.for(QUEUES.level, entry_id)).value,
      level_flagged: !unit && s.flagged,
      themes: s.themes,
      english: { ipa: s.ipa, variants: s.variants, examples: s.examples },
      l1: s.l1,
    }
  })

  const dropped = (e: DraftEntry) =>
    foldField(e.english, decisions.for(QUEUES.english, e.entry_id)).dropped ||
    config.l1s.some((l) => foldField(e.l1[l], decisions.for(QUEUES.translation(l), e.entry_id)).dropped)
  const live = selectLive(
    entries.map((e) => ({ entry_id: e.entry_id, level: e.level, rank: e.rank, order: e.order, pinned: e.pinned || e.essential, wasLive: last.live.has(e.entry_id), dropped: dropped(e) })),
    config.levels,
    config.targets,
  )
  const liveEntries = entries.filter((e) => live.has(e.entry_id))
  const units = assignUnits(
    registry.units,
    liveEntries.map((e) => ({ entry_id: e.entry_id, level: e.level, theme: e.themes[0] ?? '', rank: e.rank, order: e.order })),
    last.published,
    config.unit_size,
  )
  registry = { entries: registry.entries, units }

  const byId = new Map(entries.map((e) => [e.entry_id, e]))
  const liveUnits = units.filter((u) => u.entry_ids.some((id) => live.has(id)))
  const titles = await titleUnits(
    liveUnits.map((u) => ({ unit_id: u.unit_id, level: u.level, words: u.entry_ids.filter((id) => live.has(id)).map((id) => byId.get(id)!.headword) })),
    config.l1s,
    run('titles'),
  )

  const problems = registry.entries
    .filter((e) => e.pinned && !live.has(e.entry_id))
    .map((e) =>
      byId.has(e.entry_id)
        ? `pinned entry ${e.entry_id} (${e.headword}, ${e.pos}) is not live: it was dropped or its level left the shipped levels`
        : `pinned entry ${e.entry_id} (${e.headword}, ${e.pos}) is not live: the senses stage no longer proposes it`,
    )
  const draft: Draft = {
    live: liveEntries.map((e) => e.entry_id),
    entries,
    units: units.map((u) => ({ ...u, titles: titles.get(u.unit_id) ?? {} })),
    problems,
  }
  writeJson(paths.registry, registry)
  writeJson(paths.draft, draft)
  return draft
}

export function readDraft(dir: string): Draft {
  return readJson<Draft>(contentPaths(dir).draft)
}

/** essentials.txt: one headword per line, # for comments (Decision 19). */
export function readEssentials(dir: string): string[] {
  const file = contentPaths(dir).essentials
  if (!existsSync(file)) return []
  return [...new Set(readFileSync(file, 'utf8').split(/\r?\n/).map((l) => norm(l.replace(/#.*/, ''))).filter((l) => l !== ''))]
}
