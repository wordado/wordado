import type { MasteryTier } from './mastery'
import type { Rng } from './rng'
import type { Mode } from './types'

/** Modes that offer options to choose from (spec §7.5). */
export const RECOGNITION_MODES: readonly Mode[] = ['multiple_choice', 'listening_select']

/** Modes with nothing to choose from. Phase 2 adds typing, cloze and listening_type. */
export const RECALL_MODES: readonly Mode[] = ['flashcard']

/**
 * Picks the mode for one item of a mixed session: recognition while the word
 * is new or learning, recall once it is young or better. `available` is what
 * can run right now — the caller leaves out listening_select when the clip is
 * not cached and the device is offline, or when the learner has audio off.
 * Matching is a practice game and is never picked.
 */
export function chooseMode(tier: MasteryTier, available: ReadonlySet<Mode>, rng: Rng): Mode {
  const wantsRecall = tier === 'young' || tier === 'mature'
  const [preferred, fallback] = wantsRecall
    ? [RECALL_MODES, RECOGNITION_MODES]
    : [RECOGNITION_MODES, RECALL_MODES]
  for (const group of [preferred, fallback]) {
    const usable = group.filter((mode) => available.has(mode))
    if (usable.length > 0) return usable[Math.floor(rng() * usable.length)]!
  }
  throw new Error('No schedulable game mode is available')
}
