import { masteryTier } from './mastery'
import type { Rng } from './rng'
import type { ReviewState } from './scheduler'
import { Grade } from './types'

/**
 * How practice leans towards weaker words (spec §7.4). Tuning (§15): the
 * weakest word is drawn about five times as readily as the strongest.
 */
export const PRACTICE_WEIGHT_MAX = 5
/** Added per time the word was forgotten, for the first PRACTICE_LAPSES_COUNTED times. */
export const PRACTICE_LAPSE_WEIGHT = 0.75
export const PRACTICE_LAPSES_COUNTED = 2
/** Added for short-lived memory, by mastery tier (stability under 4 days, under 21 days). */
export const PRACTICE_TIER_WEIGHT = { learning: 1.5, young: 0.75 } as const
/** Added when the last scheduled answer was Again (relearning), or Hard. */
export const PRACTICE_GRADE_WEIGHT = { again: 1.5, hard: 0.75 } as const

/**
 * How readily practice draws a word, from its memory state alone: 1 for a
 * mature word that was never forgotten and was last rated Good or Easy, and
 * more — up to PRACTICE_WEIGHT_MAX — for each sign that it is weaker:
 *
 *   1 + 0.75 × min(lapses, 2)                    forgotten before
 *     + 1.5 learning | 0.75 young | 0 mature     how long the memory lasts (stability)
 *     + 1.5 last Again | 0.75 last Hard | 0      how the last scheduled answer went
 *
 * It is a weight for a random draw, not a rank: every word can still come up.
 * Practice answers never change the state (spec §7.4), so practising a word
 * does not lower its weight; only its scheduled reviews do.
 */
export function practiceWeight(state: ReviewState): number {
  const tier = masteryTier(state)
  const lapses = PRACTICE_LAPSE_WEIGHT * Math.min(Math.max(state.lapses, 0), PRACTICE_LAPSES_COUNTED)
  const memory = tier === 'learning' ? PRACTICE_TIER_WEIGHT.learning : tier === 'young' ? PRACTICE_TIER_WEIGHT.young : 0
  const last = state.lastGrade === Grade.Again ? PRACTICE_GRADE_WEIGHT.again : state.lastGrade === Grade.Hard ? PRACTICE_GRADE_WEIGHT.hard : 0
  return Math.min(PRACTICE_WEIGHT_MAX, 1 + lapses + memory + last)
}

/**
 * A weighted random order: a draw without replacement in which, at every
 * place, an item's chance is its share of the weight still left. Its first
 * `n` items are a weighted sample of `n`. (Efraimidis and Spirakis: each item
 * gets the key `rng() ** (1 / weight)`, and the keys are sorted downwards.)
 */
export function weightedOrder<T>(items: readonly T[], weight: (item: T) => number, rng: Rng): T[] {
  return items
    .map((item) => ({ item, key: rng() ** (1 / Math.max(weight(item), Number.EPSILON)) }))
    .sort((a, b) => b.key - a.key)
    .map((keyed) => keyed.item)
}
