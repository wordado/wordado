import { compareEvents, isScheduled, resolveAlias, type AliasMap, type ReplayEvent } from './replay'
import { localDay, type ReviewState } from './scheduler'
import { Grade } from './types'
import type { WordId } from './wordId'

/**
 * What one answer was, for XP, the daily counts and the progress metrics:
 * `new` — a word's first scheduled review ever; `review` — its first scheduled
 * review of a local day; `repeat` — a later scheduled answer the same day
 * (relearning); `practice` — a practice or matching answer (spec §7.4, §8.7).
 */
export type EventKind = 'new' | 'review' | 'repeat' | 'practice'

export interface ClassifiedEvent<E extends ReplayEvent = ReplayEvent> {
  readonly event: E
  readonly kind: EventKind
  /** The word after alias resolution. */
  readonly wordId: WordId
  /** The learner's local day of the answer. */
  readonly day: number
}

export interface ActivityOptions {
  readonly aliases?: AliasMap
  /**
   * Review state derived from everything before `events`. The server passes
   * nothing and classifies the whole log; a client passes the state it pulled
   * and classifies the events it has recorded since (spec §4.3).
   */
  readonly prior?: ReadonlyMap<WordId, ReviewState>
}

/**
 * Classifies events in replay order, deduplicated on reviewId, so that every
 * count derived from the log is a function of the set of events.
 */
export function classifyEvents<E extends ReplayEvent>(
  events: Iterable<E>,
  options: ActivityOptions = {},
): ClassifiedEvent<E>[] {
  const aliases = options.aliases ?? new Map()
  const ordered = [...events].sort(compareEvents)
  const unique = new Map<string, E>()
  for (const event of ordered) {
    if (!unique.has(event.reviewId)) unique.set(event.reviewId, event)
  }
  const lastDay = new Map<WordId, number>()
  for (const [wordId, state] of options.prior ?? []) lastDay.set(wordId, state.lastReviewDay)

  const out: ClassifiedEvent<E>[] = []
  for (const event of unique.values()) {
    const wordId = resolveAlias(event.wordId, aliases)
    const day = localDay(event.effectiveTs, event.clientTzOffsetMin)
    let kind: EventKind = 'practice'
    if (isScheduled(event)) {
      const last = lastDay.get(wordId)
      // `>=`: a last day later than this answer's (a device ahead) is still the
      // same day's repeat, mirroring composeSession's relearning check and the
      // scheduler's same-day elapsed-0 treatment.
      kind = last === undefined ? 'new' : last >= day ? 'repeat' : 'review'
      lastDay.set(wordId, day)
    }
    out.push({ event, kind, wordId, day })
  }
  return out
}

/** The counts session composition and the day-complete rule read (spec §7.4, §8.4). */
export interface DayCounts {
  /** Distinct words, introduced before the day, whose first scheduled review of the day is answered. */
  readonly reviewsDone: number
  readonly newWordsDone: number
  readonly practiceDone: number
  /** Every answer given that day, of any kind. */
  readonly answered: number
}

export function dayCounts(classified: Iterable<ClassifiedEvent>, day: number): DayCounts {
  let reviewsDone = 0
  let newWordsDone = 0
  let practiceDone = 0
  let answered = 0
  for (const item of classified) {
    if (item.day !== day) continue
    answered += 1
    if (item.kind === 'review') reviewsDone += 1
    else if (item.kind === 'new') newWordsDone += 1
    else if (item.kind === 'practice') practiceDone += 1
  }
  return { reviewsDone, newWordsDone, practiceDone, answered }
}

/** One local day of the compact summary a pull carries (spec §8.3). */
export interface DaySummary {
  readonly day: number
  /** First scheduled reviews of the day of words introduced earlier. */
  readonly reviews: number
  /** Those answered with any grade but Again. */
  readonly successes: number
  readonly newWords: number
  /** Every answer of any kind that day: what a device needs to rebuild `answeredToday` after a pull. */
  readonly answered: number
  readonly practice: number
}

export function summarizeDays(classified: Iterable<ClassifiedEvent>): Map<number, DaySummary> {
  const out = new Map<number, DaySummary>()
  for (const item of classified) {
    const prev = out.get(item.day) ?? { day: item.day, reviews: 0, successes: 0, newWords: 0, answered: 0, practice: 0 }
    const review = item.kind === 'review'
    out.set(item.day, {
      day: item.day,
      reviews: prev.reviews + (review ? 1 : 0),
      successes: prev.successes + (review && item.event.grade !== Grade.Again ? 1 : 0),
      newWords: prev.newWords + (item.kind === 'new' ? 1 : 0),
      answered: prev.answered + 1,
      practice: prev.practice + (item.kind === 'practice' ? 1 : 0),
    })
  }
  return out
}

/** Adds summaries day by day: the pulled summary plus the days recorded since. */
export function mergeSummaries(...sources: Iterable<DaySummary>[]): Map<number, DaySummary> {
  const out = new Map<number, DaySummary>()
  for (const source of sources) {
    for (const s of source) {
      const prev = out.get(s.day)
      out.set(
        s.day,
        prev
          ? {
              day: s.day,
              reviews: prev.reviews + s.reviews,
              successes: prev.successes + s.successes,
              newWords: prev.newWords + s.newWords,
              answered: prev.answered + s.answered,
              practice: prev.practice + s.practice,
            }
          : s,
      )
    }
  }
  return out
}
