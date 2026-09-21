import { Grade, type Mode } from './types'

/** What a game mode reports about one answer (spec §7.3). */
export type AnswerOutcome =
  | { readonly kind: 'self_rated'; readonly rating: Grade }
  | {
      readonly kind: 'binary'
      readonly correct: boolean
      readonly latencyMs: number
      /** Accepted with a distance-1 typo. Phase 2 typing modes only. */
      readonly typo?: boolean
    }

export interface GradingOptions {
  /** Off for learners who need more time (spec §11.1). */
  readonly latencyGrading: boolean
}

/**
 * A correct answer slower than this grades Hard. Tuning values (spec §15).
 * Flashcards are self-rated and matching is a game, so neither has one.
 */
export const SLOW_THRESHOLD_MS: Readonly<Record<Mode, number>> = {
  flashcard: Number.POSITIVE_INFINITY,
  multiple_choice: 8_000,
  listening_select: 8_000,
  matching: Number.POSITIVE_INFINITY,
}

export function gradeAnswer(mode: Mode, outcome: AnswerOutcome, options: GradingOptions): Grade {
  if (outcome.kind === 'self_rated') {
    if (mode !== 'flashcard') throw new Error(`Mode ${mode} cannot be self-rated`)
    return outcome.rating
  }
  if (mode === 'flashcard') throw new Error('Flashcards are self-rated')
  if (!outcome.correct) return Grade.Again
  if (outcome.typo === true) return Grade.Hard
  if (options.latencyGrading && outcome.latencyMs > SLOW_THRESHOLD_MS[mode]) return Grade.Hard
  return Grade.Good
}
