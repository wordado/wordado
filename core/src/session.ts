import { isDue, retrievability, type ReviewState } from './scheduler'
import type { WordFlag } from './types'
import type { WordId } from './wordId'

/** Defaults and bounds for the learner's settings (spec §7.4). Tuning values (§15). */
export const DEFAULT_NEW_WORD_LIMIT = 10
export const MAX_NEW_WORD_LIMIT = 30
export const DEFAULT_REVIEW_CAP = 100

export interface SessionInput {
  readonly now: number
  /**
   * The learner's local day number: `localDay(now, tzOffsetMin)`. Due-ness is a
   * question about the calendar day (spec §8.4), so the home screen's count and
   * the session it starts are the same call and give the same numbers.
   */
  readonly today: number
  readonly states: ReadonlyMap<WordId, ReviewState>
  readonly flags: ReadonlyMap<WordId, WordFlag>
  /** Desired retention, e.g. RETENTION_TARGETS.standard. */
  readonly retention: number
  readonly newWordLimit: number
  readonly reviewCap: number
  /**
   * Distinct words, introduced before today, whose first scheduled
   * (non-practice) review of the day has been answered. Same-day repeats and
   * follow-ups of words introduced today do not count.
   */
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
  /** Everything scheduled for today, ignoring the cap: the home screen's secondary number. */
  readonly backlogTotal: number
  /** True when the backlog exceeds the cap, so new words wait. */
  readonly newWordsPaused: boolean
}

interface DueWord {
  readonly wordId: WordId
  readonly r: number
}

/** Weakest memory first, with a stable tie-break so every device agrees. */
function weakestFirst(a: DueWord, b: DueWord): number {
  return a.r - b.r || (a.wordId < b.wordId ? -1 : 1)
}

export function composeSession(input: SessionInput): SessionPlan {
  // Words rated Again earlier today are a repeat of work already started: the
  // daily cap and the backlog are about words the schedule brought up today.
  const scheduled: DueWord[] = []
  const relearning: DueWord[] = []
  for (const [wordId, state] of input.states) {
    if (input.flags.has(wordId)) continue
    if (!isDue(state, input.retention, input.now, input.today)) continue
    const due: DueWord = { wordId, r: retrievability(state, input.now) }
    if (state.lastReviewDay === input.today) relearning.push(due)
    else scheduled.push(due)
  }
  scheduled.sort(weakestFirst)
  relearning.sort(weakestFirst)

  const capLeft = Math.max(0, input.reviewCap - input.reviewsDoneToday)
  const newWordsPaused = scheduled.length > capLeft
  const limit = Math.min(Math.max(input.newWordLimit, 0), MAX_NEW_WORD_LIMIT)
  const quota = newWordsPaused ? 0 : Math.max(0, limit - input.newWordsDoneToday)

  // Only words that can still be introduced decide which source is live: a
  // collection whose remaining words are all introduced or flagged is spent,
  // and the path resumes (spec §7.4).
  const servable = (wordId: WordId) => !input.states.has(wordId) && !input.flags.has(wordId)
  const personal = input.personalNew.filter(servable)
  const collection = (input.collectionNew ?? []).filter(servable)
  const path = input.pathNew.filter(servable)

  // An active collection with words left takes the whole quota; the path waits.
  const newWords: WordId[] = []
  for (const source of [personal, collection.length > 0 ? collection : path]) {
    for (const wordId of source) {
      if (newWords.length >= quota) break
      if (!newWords.includes(wordId)) newWords.push(wordId)
    }
  }

  return {
    reviews: [...scheduled.slice(0, capLeft), ...relearning].map((d) => d.wordId),
    newWords,
    backlogTotal: scheduled.length,
    newWordsPaused,
  }
}
