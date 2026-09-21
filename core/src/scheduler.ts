import { FSRSAlgorithm, generatorParameters } from 'ts-fsrs'
import { Grade } from './types'
import type { WordId } from './wordId'

/**
 * Identifies the FSRS library, its parameter set and our scheduling rules.
 * Any change to a rule or parameter in this file is a version bump (spec §4.3).
 */
export const SCHEDULER_VERSION = 'fsrs6-tsfsrs5.4.2-r1'

export const DAY_MS = 86_400_000

/** A word rated Again comes back the same day, after this long. */
export const RELEARN_DELAY_MS = 10 * 60 * 1000

export const MAX_INTERVAL_DAYS = 36_500

/** The learner-facing desired-retention setting (spec §7.1). Tuning values (§15). */
export const RETENTION_TARGETS = { relaxed: 0.85, standard: 0.9, intensive: 0.94 } as const
export type RetentionSetting = keyof typeof RETENTION_TARGETS

/** FSRS memory state for one word. Derived from events, never edited. */
export interface ReviewState {
  readonly wordId: WordId
  readonly stability: number
  readonly difficulty: number
  readonly introducedTs: number
  readonly lastReviewTs: number
  readonly lastGrade: Grade
  readonly reps: number
  readonly lapses: number
}

// Fuzz is off so that every engine derives the same state from the same events.
const algorithm = new FSRSAlgorithm(generatorParameters({ enable_fuzz: false, enable_short_term: true }))

/** Whole days between two instants. Time-zone free, so client and server agree. */
function elapsedDays(fromTs: number, toTs: number): number {
  return Math.max(0, Math.floor((toTs - fromTs) / DAY_MS))
}

/** Applies one scheduled answer. `prev` is null for a word's first review. */
export function applyGrade(prev: ReviewState | null, wordId: WordId, grade: Grade, ts: number): ReviewState {
  const memory = prev ? { stability: prev.stability, difficulty: prev.difficulty } : null
  const next = algorithm.next_state(memory, prev ? elapsedDays(prev.lastReviewTs, ts) : 0, grade)
  return {
    wordId,
    stability: next.stability,
    difficulty: next.difficulty,
    introducedTs: prev ? prev.introducedTs : ts,
    lastReviewTs: ts,
    lastGrade: grade,
    reps: (prev?.reps ?? 0) + 1,
    lapses: (prev?.lapses ?? 0) + (prev && grade === Grade.Again ? 1 : 0),
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

export function dueAt(state: ReviewState, retention: number): number {
  if (state.lastGrade === Grade.Again) return state.lastReviewTs + RELEARN_DELAY_MS
  return state.lastReviewTs + intervalDays(state.stability, retention) * DAY_MS
}

/** Predicted probability of recall at `now`, in [0, 1]. */
export function retrievability(state: ReviewState, now: number): number {
  const days = Math.max(0, (now - state.lastReviewTs) / DAY_MS)
  return algorithm.forgetting_curve(days, state.stability)
}
