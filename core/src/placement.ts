import { shuffle, type Rng } from './rng'
import { CEFR_LEVELS, type CefrLevel, type CorpusEntry } from './types'
import { corpusWordId, type WordId } from './wordId'

/** Words asked per band, and how many must be right for the band to count as known. Tuning (§15). */
export const PLACEMENT_PROBE_SIZE = 8
export const PLACEMENT_PASS_MIN = 6

export interface PlacementAnswer {
  readonly wordId: WordId
  /** The band the word was drawn from. */
  readonly level: CefrLevel
  readonly correct: boolean
}

export interface PlacementProgress {
  /** The band being probed, or null once the test is decided. */
  readonly probing: CefrLevel | null
  /** Answers the current probe can still take before it is decided either way. */
  readonly remainingInProbe: number
  /** The level to place the learner at: the lowest band they did not pass. */
  readonly result: CefrLevel | null
}

/**
 * A binary search over the bands for the lowest one the learner does not know,
 * from the answers so far in order (spec §7.2). A probe ends as soon as it is
 * decided: PLACEMENT_PASS_MIN right passes it, more than
 * PLACEMENT_PROBE_SIZE − PLACEMENT_PASS_MIN wrong fails it. Passing every band
 * places the learner at the highest.
 */
export function placementProgress(answers: readonly PlacementAnswer[], levels: readonly CefrLevel[] = CEFR_LEVELS): PlacementProgress {
  if (levels.length === 0) throw new Error('Placement needs at least one band')
  const maxWrong = PLACEMENT_PROBE_SIZE - PLACEMENT_PASS_MIN
  let lo = 0
  let hi = levels.length - 1
  let i = 0
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const band = levels[mid]!
    let right = 0
    let wrong = 0
    while (right < PLACEMENT_PASS_MIN && wrong <= maxWrong) {
      const answer = answers[i]
      if (!answer) return { probing: band, remainingInProbe: PLACEMENT_PROBE_SIZE - right - wrong, result: null }
      if (answer.level !== band) throw new Error(`Expected an answer from ${band}, got ${answer.level}`)
      i += 1
      if (answer.correct) right += 1
      else wrong += 1
    }
    if (right >= PLACEMENT_PASS_MIN) lo = mid + 1
    else hi = mid
  }
  return { probing: null, remainingInProbe: 0, result: levels[lo]! }
}

/**
 * Words to ask next, drawn at random from the band being probed, never one
 * already asked: at most `remainingInProbe`, fewer only if the band has no
 * more words to give, and none once the test is decided.
 */
export function nextPlacementWords(
  answers: readonly PlacementAnswer[],
  pool: ReadonlyMap<CefrLevel, readonly WordId[]>,
  rng: Rng,
  levels: readonly CefrLevel[] = CEFR_LEVELS,
): WordId[] {
  const progress = placementProgress(answers, levels)
  if (progress.probing === null) return []
  const asked = new Set(answers.map((a) => a.wordId))
  const candidates = (pool.get(progress.probing) ?? []).filter((id) => !asked.has(id))
  return shuffle(candidates, rng).slice(0, progress.remainingInProbe)
}

/** A test over fewer bands than this has nothing to decide (spec §7.2). */
export const MIN_PLACEMENT_LEVELS = 2

/** Live corpus words by band: what a placement test draws from. Retired entries are never asked. */
export function placementPool(entries: Iterable<CorpusEntry>): Map<CefrLevel, WordId[]> {
  const out = new Map<CefrLevel, WordId[]>()
  for (const entry of entries) {
    if (entry.retired) continue
    const list = out.get(entry.level) ?? []
    list.push(corpusWordId(entry.entryId))
    out.set(entry.level, list)
  }
  return out
}

/**
 * The bands a placement test searches: from A1 upward, each with a whole
 * probe's worth of words, stopping at the first that has not. A band cannot
 * be probed past a gap, because the search compares neighbours.
 */
export function placementLevels(pool: ReadonlyMap<CefrLevel, readonly WordId[]>): CefrLevel[] {
  const out: CefrLevel[] = []
  for (const level of CEFR_LEVELS) {
    if ((pool.get(level)?.length ?? 0) < PLACEMENT_PROBE_SIZE) break
    out.push(level)
  }
  return out
}
