import type { CefrLevel } from '@wordado/core'

export interface SelectCandidate {
  readonly entry_id: string
  readonly level: CefrLevel
  /** The lemma's frequency rank. */
  readonly rank: number
  /** The sense's position among its lemma's senses. */
  readonly order: number
  readonly pinned: boolean
  /** Live in the last published pack. */
  readonly wasLive: boolean
  /** A reviewer dropped it. */
  readonly dropped: boolean
}

/** Which main meanings of a level are live whatever its size: all of them, or those whose word ranks within a bound. */
export type MainMeaningRule = 'all' | number

/**
 * The live entries (Decision 9). Pinned and previously live entries stay,
 * so a learner's words never vanish between versions. Then come the main
 * meanings a level's rule names (spec 2026-10-06 §3.3): an easy word must
 * not be left out because more frequent ones filled its level. Both count
 * toward the level's size, which the most frequent of the rest fill.
 * A dropped entry is never live. An entry of a level this corpus does not
 * ship is never live.
 */
export function selectLive(
  candidates: readonly SelectCandidate[],
  levels: readonly CefrLevel[],
  sizes: Readonly<Record<CefrLevel, number>>,
  mainMeanings: Readonly<Partial<Record<CefrLevel, MainMeaningRule>>> = {},
): Set<string> {
  const live = new Set<string>()
  const count = new Map<CefrLevel, number>()
  const add = (c: SelectCandidate) => {
    live.add(c.entry_id)
    count.set(c.level, (count.get(c.level) ?? 0) + 1)
  }
  const shipped = candidates.filter((c) => levels.includes(c.level) && !c.dropped)
  for (const c of shipped) if (c.pinned || c.wasLive) add(c)
  for (const c of shipped) {
    const rule = mainMeanings[c.level]
    // A main meaning's rank is its word's rank (`senseRank` with order 0).
    if (live.has(c.entry_id) || c.order !== 0 || rule === undefined) continue
    if (rule === 'all' || c.rank <= rule) add(c)
  }
  const rest = shipped
    .filter((c) => !live.has(c.entry_id))
    .sort((a, b) => a.rank - b.rank || a.order - b.order || (a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0))
  for (const c of rest) if ((count.get(c.level) ?? 0) < sizes[c.level]) add(c)
  return live
}

/** How much rarer each later sense of a word counts than the one before it. */
export const SENSE_RANK_FACTOR = 3

/**
 * A sense's rank for banding and selection. Every sense of a word shares the word's frequency, so a common word's
 * rare sense ("title" as a legal document) used to rank with its main one and take a slot from another word's main
 * meaning. The stage lists senses most common first; each later one now counts as if the word were three times
 * rarer.
 */
export function senseRank(lemmaRank: number, order: number): number {
  return lemmaRank * SENSE_RANK_FACTOR ** order
}
