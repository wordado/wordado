import { FSRSAlgorithm, generatorParameters } from 'ts-fsrs'
import { Grade } from './types'
import type { WordId } from './wordId'

/**
 * Identifies the FSRS library, its parameter set and our scheduling rules.
 * Any change to a rule or parameter in this file is a version bump (spec §4.3).
 */
export const SCHEDULER_VERSION = 'fsrs6-tsfsrs5.4.2-r2'

export const DAY_MS = 86_400_000

/** A word rated Again comes back the same day, after this long. */
export const RELEARN_DELAY_MS = 10 * 60 * 1000

export const MAX_INTERVAL_DAYS = 36_500

/** The learner-facing desired-retention setting (spec §7.1). Tuning values (§15). */
export const RETENTION_TARGETS = { relaxed: 0.85, standard: 0.9, intensive: 0.94 } as const
export type RetentionSetting = keyof typeof RETENTION_TARGETS

/**
 * The learner's local calendar day as an integer, days since the epoch
 * (spec §8.4: a day is the local date at the moment of the answer).
 * `tzOffsetMin` is minutes to ADD to UTC, as on ReviewEvent.clientTzOffsetMin.
 */
export function localDay(ts: number, tzOffsetMin: number): number {
  return Math.floor((ts + tzOffsetMin * 60_000) / DAY_MS)
}

/** FSRS memory state for one word. Derived from events, never edited. */
export interface ReviewState {
  readonly wordId: WordId
  readonly stability: number
  readonly difficulty: number
  readonly introducedTs: number
  readonly lastReviewTs: number
  /** Local calendar day of the last review: what scheduling counts in. */
  readonly lastReviewDay: number
  readonly lastGrade: Grade
  readonly reps: number
  /**
   * Times the word left a passed state: an Again on a word whose last grade was
   * not Again. Consecutive Agains while relearning are one lapse, not several.
   */
  readonly lapses: number
}

// Fuzz is off so that every engine derives the same state from the same events.
const algorithm = new FSRSAlgorithm(generatorParameters({ enable_fuzz: false, enable_short_term: true }))

/**
 * Applies one scheduled answer. `prev` is null for a word's first review.
 * `tzOffsetMin` is the offset the answer was given at (ReviewEvent.clientTzOffsetMin),
 * so FSRS is told how many calendar days the learner actually let pass.
 */
export function applyGrade(
  prev: ReviewState | null,
  wordId: WordId,
  grade: Grade,
  ts: number,
  tzOffsetMin: number,
): ReviewState {
  const day = localDay(ts, tzOffsetMin)
  const memory = prev ? { stability: prev.stability, difficulty: prev.difficulty } : null
  const elapsedDays = prev ? Math.max(0, day - prev.lastReviewDay) : 0
  const next = algorithm.next_state(memory, elapsedDays, grade)
  const lapsed = prev !== null && grade === Grade.Again && prev.lastGrade !== Grade.Again
  return {
    wordId,
    stability: next.stability,
    difficulty: next.difficulty,
    introducedTs: prev ? prev.introducedTs : ts,
    lastReviewTs: ts,
    lastReviewDay: day,
    lastGrade: grade,
    reps: (prev?.reps ?? 0) + 1,
    lapses: (prev?.lapses ?? 0) + (lapsed ? 1 : 0),
  }
}

/**
 * Days until predicted recall falls to `retention`. Depends on stability
 * alone, so changing the retention setting needs no replay (spec §7.1).
 */
export function intervalDays(stability: number, retention: number): number {
  const days = Math.round(stability * algorithm.calculate_interval_modifier(retention))
  return Math.min(Math.max(days, 1), MAX_INTERVAL_DAYS)
}

/** The local calendar day a passed word comes back on. */
export function dueDay(state: ReviewState, retention: number): number {
  return state.lastReviewDay + intervalDays(state.stability, retention)
}

/**
 * Whether the word is to be served. A word rated Again is relearning and comes
 * back `RELEARN_DELAY_MS` after the answer; every other word is due on a whole
 * local day, so the home screen and a session ask the same question and get
 * the same answer (spec §8.4).
 */
export function isDue(state: ReviewState, retention: number, now: number, today: number): boolean {
  if (state.lastGrade === Grade.Again) return now >= state.lastReviewTs + RELEARN_DELAY_MS
  return today >= dueDay(state, retention)
}

/** Predicted probability of recall at `now`, in [0, 1]. */
export function retrievability(state: ReviewState, now: number): number {
  const days = Math.max(0, (now - state.lastReviewTs) / DAY_MS)
  return algorithm.forgetting_curve(days, state.stability)
}
