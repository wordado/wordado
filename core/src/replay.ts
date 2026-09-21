import { applyGrade, type ReviewState } from './scheduler'
import type { StampedReviewEvent } from './types'
import type { WordId } from './wordId'

/** The fields of an event that replay reads. A StampedReviewEvent satisfies it. */
export type ReplayEvent = Pick<
  StampedReviewEvent,
  | 'reviewId'
  | 'wordId'
  | 'mode'
  | 'grade'
  | 'practice'
  | 'effectiveTs'
  | 'clientTzOffsetMin'
  | 'deviceId'
  | 'deviceSeq'
>

/** user word → corpus entry merges (spec §6.1). Events are never rewritten. */
export type AliasMap = ReadonlyMap<WordId, WordId>

export function resolveAlias(wordId: WordId, aliases: AliasMap): WordId {
  let current = wordId
  const seen = new Set<WordId>([current])
  for (let next = aliases.get(current); next !== undefined; next = aliases.get(current)) {
    if (seen.has(next)) throw new Error(`Alias cycle at ${next}`)
    seen.add(next)
    current = next
  }
  return current
}

/** The total, deterministic replay order (spec §9.2). */
export function compareEvents(a: ReplayEvent, b: ReplayEvent): number {
  if (a.effectiveTs !== b.effectiveTs) return a.effectiveTs - b.effectiveTs
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1
  if (a.deviceSeq !== b.deviceSeq) return a.deviceSeq - b.deviceSeq
  return a.reviewId < b.reviewId ? -1 : a.reviewId > b.reviewId ? 1 : 0
}

/**
 * An event that never moves the schedule: practice, and every matching answer,
 * whatever the client flagged it as. The engine is what makes the rule true
 * (spec §8.1, §13) — the server accepts any well-formed event.
 */
function isScheduled(event: ReplayEvent): boolean {
  return !event.practice && event.mode !== 'matching'
}

/**
 * Derives review state from the event log. The result depends only on the
 * set of events: not on their order, and not on duplicates. Practice and
 * matching events are skipped (spec §7.4, §8.1).
 */
export function replay(
  events: Iterable<ReplayEvent>,
  aliases: AliasMap = new Map(),
): Map<WordId, ReviewState> {
  // Ordering before deduplication keeps the choice between two payloads that
  // collide on one reviewId a function of the events, not of their arrival.
  const ordered = [...events].filter(isScheduled).sort(compareEvents)
  const unique = new Map<string, ReplayEvent>()
  for (const event of ordered) {
    if (!unique.has(event.reviewId)) unique.set(event.reviewId, event)
  }
  const states = new Map<WordId, ReviewState>()
  for (const event of unique.values()) {
    const wordId = resolveAlias(event.wordId, aliases)
    const prev = states.get(wordId) ?? null
    states.set(wordId, applyGrade(prev, wordId, event.grade, event.effectiveTs, event.clientTzOffsetMin))
  }
  return states
}
