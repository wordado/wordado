import type { DaySummary } from './activity'
import { masteryTier } from './mastery'
import { isLive, type PathContext } from './path'
import type { ReviewState } from './scheduler'
import { levelIndex, type CefrLevel, type Unit } from './types'
import type { WordId } from './wordId'

export const RETENTION_WINDOW_DAYS = 30

/**
 * Share of first-attempt successes among scheduled reviews of words last seen
 * on an earlier day, over the trailing window ending today (spec §8.3). Null
 * until there is a review to count.
 */
export function retentionRate(
  summaries: Iterable<DaySummary>,
  today: number,
  windowDays: number = RETENTION_WINDOW_DAYS,
): number | null {
  let reviews = 0
  let successes = 0
  for (const s of summaries) {
    if (s.day <= today - windowDays || s.day > today) continue
    reviews += s.reviews
    successes += s.successes
  }
  return reviews === 0 ? null : successes / reviews
}

/** Shares of a unit's live words for the two cosmetic markers (spec §7.2). Tuning (§15). */
export const UNIT_COMPLETE_SHARE = 0.8
export const UNIT_MASTERED_SHARE = 0.9

export interface UnitProgress {
  readonly live: number
  readonly introduced: number
  /** Live words with a successful non-practice review on a later day. */
  readonly passed: number
  readonly mature: number
  readonly complete: boolean
  readonly mastered: boolean
}

type Visibility = Pick<PathContext, 'retired' | 'flags'>

export function unitProgress(unit: Unit, states: ReadonlyMap<WordId, ReviewState>, ctx: Visibility): UnitProgress {
  let live = 0
  let introduced = 0
  let passed = 0
  let mature = 0
  for (const wordId of unit.wordIds) {
    if (!isLive(wordId, ctx)) continue
    live += 1
    // A known word is known-by-declaration, never mature; flags are excluded by `isLive` above.
    const state = states.get(wordId) ?? null
    if (!state) continue
    introduced += 1
    if (state.passedOnLaterDay) passed += 1
    if (masteryTier(state) === 'mature') mature += 1
  }
  return {
    live,
    introduced,
    passed,
    mature,
    complete: live > 0 && passed >= UNIT_COMPLETE_SHARE * live,
    mastered: live > 0 && mature >= UNIT_MASTERED_SHARE * live,
  }
}

export type LevelCompletion =
  /** A band below the declared level: "skipped — placed above", never 100% (spec §7.2). */
  | { readonly kind: 'skipped' }
  | { readonly kind: 'progress'; readonly live: number; readonly mature: number; readonly share: number }

/** The share of a CEFR band's live entries that are mature (spec §8.3). */
export function levelCompletion(
  level: CefrLevel,
  units: readonly Unit[],
  states: ReadonlyMap<WordId, ReviewState>,
  ctx: Visibility & Pick<PathContext, 'declaredLevel'>,
): LevelCompletion {
  if (levelIndex(level) < levelIndex(ctx.declaredLevel)) return { kind: 'skipped' }
  let live = 0
  let mature = 0
  for (const unit of units) {
    if (unit.level !== level) continue
    const progress = unitProgress(unit, states, ctx)
    live += progress.live
    mature += progress.mature
  }
  return { kind: 'progress', live, mature, share: live === 0 ? 0 : mature / live }
}
