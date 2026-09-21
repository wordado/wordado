import type { ReviewState } from './scheduler'

/** Progress tiers shown to the learner (spec §8.3). */
export type MasteryTier = 'new' | 'learning' | 'young' | 'mature'

/**
 * Stability, in days, at which a word enters a tier. Presentational:
 * changing these re-labels existing state and needs no re-derivation (§4.3).
 */
export const TIER_MIN_STABILITY_DAYS = { young: 4, mature: 21 } as const

/**
 * The tier for one word's memory state. It cannot see flags: a word flagged
 * known is shown as known-by-declaration and must be excluded by the caller
 * before mature words are counted (spec §7.4).
 */
export function masteryTier(state: ReviewState | null | undefined): MasteryTier {
  if (!state) return 'new'
  if (state.stability >= TIER_MIN_STABILITY_DAYS.mature) return 'mature'
  if (state.stability >= TIER_MIN_STABILITY_DAYS.young) return 'young'
  return 'learning'
}
