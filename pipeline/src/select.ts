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

/**
 * The live entries (Decision 9). Pinned and previously live entries stay,
 * so a learner's words never vanish between versions. They count toward
 * their level's target (spec §5.3), which the most frequent of the rest fill.
 * A dropped entry is never live. An entry of a level this corpus does not
 * ship is never live.
 */
export function selectLive(candidates: readonly SelectCandidate[], levels: readonly CefrLevel[], targets: Readonly<Record<CefrLevel, number>>): Set<string> {
  const live = new Set<string>()
  const count = new Map<CefrLevel, number>()
  const add = (c: SelectCandidate) => {
    live.add(c.entry_id)
    count.set(c.level, (count.get(c.level) ?? 0) + 1)
  }
  const shipped = candidates.filter((c) => levels.includes(c.level) && !c.dropped)
  for (const c of shipped) if (c.pinned || c.wasLive) add(c)
  const rest = shipped
    .filter((c) => !live.has(c.entry_id))
    .sort((a, b) => a.rank - b.rank || a.order - b.order || (a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0))
  for (const c of rest) if ((count.get(c.level) ?? 0) < targets[c.level]) add(c)
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
