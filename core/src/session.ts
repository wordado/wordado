import { dueAt, retrievability, type ReviewState } from './scheduler'
import type { WordFlag } from './types'
import type { WordId } from './wordId'

/** Defaults and bounds for the learner's settings (spec §7.4). Tuning values (§15). */
export const DEFAULT_NEW_WORD_LIMIT = 10
export const MAX_NEW_WORD_LIMIT = 30
export const DEFAULT_REVIEW_CAP = 100

export interface SessionInput {
  readonly now: number
  /** Words due at or before this instant count as due: `now` for a session, the end of the local day for the home screen. */
  readonly dueBefore: number
  readonly states: ReadonlyMap<WordId, ReviewState>
  readonly flags: ReadonlyMap<WordId, WordFlag>
  /** Desired retention, e.g. RETENTION_TARGETS.standard. */
  readonly retention: number
  readonly newWordLimit: number
  readonly reviewCap: number
  /** Scheduled (non-practice) reviews of already-introduced words answered so far today. */
  readonly reviewsDoneToday: number
  readonly newWordsDoneToday: number
  /** New-word sources, each in serve order. Personal words are empty until Phase 2. */
  readonly personalNew: readonly WordId[]
  /** Null when no collection is active. */
  readonly collectionNew: readonly WordId[] | null
  readonly pathNew: readonly WordId[]
}

export interface SessionPlan {
  /** Due words to review now, weakest first, within today's cap. */
  readonly reviews: readonly WordId[]
  readonly newWords: readonly WordId[]
  /** Everything due, ignoring the cap: the home screen's secondary number. */
  readonly backlogTotal: number
  /** True when the backlog exceeds the cap, so new words wait. */
  readonly newWordsPaused: boolean
}

export function composeSession(input: SessionInput): SessionPlan {
  const due: { wordId: WordId; r: number }[] = []
  for (const [wordId, state] of input.states) {
    if (input.flags.has(wordId)) continue
    if (dueAt(state, input.retention) <= input.dueBefore) {
      due.push({ wordId, r: retrievability(state, input.now) })
    }
  }
  due.sort((a, b) => a.r - b.r || (a.wordId < b.wordId ? -1 : 1))

  const capLeft = Math.max(0, input.reviewCap - input.reviewsDoneToday)
  const newWordsPaused = due.length > capLeft
  const quota = newWordsPaused ? 0 : Math.max(0, input.newWordLimit - input.newWordsDoneToday)

  // An active collection with words left takes the whole quota; the path waits.
  const collection = input.collectionNew ?? []
  const sources = [input.personalNew, collection.length > 0 ? collection : input.pathNew]
  const newWords: WordId[] = []
  for (const source of sources) {
    for (const wordId of source) {
      if (newWords.length >= quota) break
      if (input.states.has(wordId) || input.flags.has(wordId) || newWords.includes(wordId)) continue
      newWords.push(wordId)
    }
  }

  return {
    reviews: due.slice(0, capLeft).map((d) => d.wordId),
    newWords,
    backlogTotal: due.length,
    newWordsPaused,
  }
}
