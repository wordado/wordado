import type { Corpus } from './corpus'
import { pickDistractors } from './distractors'
import { masteryTier } from './mastery'
import { chooseMode } from './modeSelection'
import { shuffle, type Rng } from './rng'
import type { ReviewState } from './scheduler'
import type { CorpusEntry, Direction, Mode, WordFlag } from './types'
import { corpusWordId, parseWordId, type WordId } from './wordId'

/** Options shown in a choice item, the answer included (spec §8.1). Tuning (§15). */
export const CHOICE_OPTIONS = 4

/** Pairs on a matching board (spec §8.1). Tuning (§15). */
export const MATCHING_PAIRS = 5

export type ChoiceMode = 'multiple_choice' | 'listening_select'

export interface FlashcardItem {
  readonly mode: 'flashcard'
  readonly wordId: WordId
  readonly entry: CorpusEntry
  readonly direction: Direction
}

export interface ChoiceItem {
  readonly mode: ChoiceMode
  readonly wordId: WordId
  readonly entry: CorpusEntry
  /** en_to_l1 shows the headword and offers translations; l1_to_en the reverse. Listening is always en_to_l1. */
  readonly direction: Direction
  /** English headwords, or for en_to_l1 multiple choice, entries whose primary translation is shown. */
  readonly options: readonly CorpusEntry[]
  readonly answerIndex: number
}

/** One question of a session: what is asked, and how (spec §8.1). */
export type StudyItem = FlashcardItem | ChoiceItem

export interface ItemContext {
  readonly corpus: Corpus
  readonly states: ReadonlyMap<WordId, ReviewState>
  /** What can run for this word right now: `client-data`'s `availableModes`. */
  readonly available: ReadonlySet<Mode>
  /** A learner-chosen single-mode session (spec §7.4); used when it can run, otherwise the mixed choice. */
  readonly preferred: Mode | null
  readonly rng: Rng
}

const flashcard = (wordId: WordId, entry: CorpusEntry): FlashcardItem => ({ mode: 'flashcard', wordId, entry, direction: 'en_to_l1' })

/**
 * Builds the item for one word (spec §7.5, §8.1): the preferred mode when it
 * can run, else `chooseMode` by mastery tier; distractors from `pickDistractors`,
 * homophones excluded for listening. A choice mode whose distractors the corpus
 * cannot supply falls back to a flashcard. Null for a word not in the corpus.
 */
export function buildItem(wordId: WordId, ctx: ItemContext): StudyItem | null {
  const { kind, key } = parseWordId(wordId)
  const entry = kind === 'corpus' ? ctx.corpus.entries.get(key) : undefined
  if (!entry) return null
  // Matching is a practice game with its own board, never a session item.
  const available: ReadonlySet<Mode> = new Set([...ctx.available].filter((mode) => mode !== 'matching'))
  const mode =
    ctx.preferred !== null && available.has(ctx.preferred)
      ? ctx.preferred
      : chooseMode(masteryTier(ctx.states.get(wordId)), available, ctx.rng)
  if (mode !== 'multiple_choice' && mode !== 'listening_select') return flashcard(wordId, entry)
  const listening = mode === 'listening_select'
  const distractors = pickDistractors(
    entry,
    { pool: [...ctx.corpus.entries.values()], encountered: new Set(ctx.states.keys()), listening },
    CHOICE_OPTIONS - 1,
    ctx.rng,
  )
  if (distractors.length < CHOICE_OPTIONS - 1) return flashcard(wordId, entry)
  const options = shuffle([entry, ...distractors], ctx.rng)
  const direction: Direction = listening || ctx.rng() < 0.5 ? 'en_to_l1' : 'l1_to_en'
  return { mode, wordId, entry, direction, options, answerIndex: options.indexOf(entry) }
}

export interface PracticeInput {
  readonly states: ReadonlyMap<WordId, ReviewState>
  readonly flags: ReadonlyMap<WordId, WordFlag>
  /** Words the schedule serves now; practising them would only duplicate the session. */
  readonly exclude: ReadonlySet<WordId>
  readonly count: number
  readonly rng: Rng
}

/** Words for extra practice (spec §7.4): introduced, not flagged, not in today's session. */
export function practiceWords(input: PracticeInput): WordId[] {
  const candidates = [...input.states.keys()].filter((id) => !input.flags.has(id) && !input.exclude.has(id))
  return shuffle(candidates, input.rng).slice(0, Math.max(0, input.count))
}

/** What a matching board may use (spec §8.1): introduced, live corpus words. */
export function matchingCandidates(
  corpus: Corpus,
  states: ReadonlyMap<WordId, ReviewState>,
  flags: ReadonlyMap<WordId, WordFlag>,
): CorpusEntry[] {
  return [...corpus.entries.values()].filter((e) => {
    const wordId = corpusWordId(e.entryId)
    return !e.retired && states.has(wordId) && !flags.has(wordId)
  })
}
