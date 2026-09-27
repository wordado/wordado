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
