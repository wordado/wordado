import { themeEntries, type Corpus } from './corpus'
import { pickDistractors } from './distractors'
import { masteryTier } from './mastery'
import { chooseMode } from './modeSelection'
import { isLive } from './path'
import { pickUnseenFirst, practiceWeight } from './practiceWeight'
import { isSkippedLevel } from './progress'
import { shuffle, type Rng } from './rng'
import type { ReviewState } from './scheduler'
import type { CefrLevel, CorpusEntry, Direction, Mode, WordFlag } from './types'
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

/** What decides whether practice may use a word. */
export interface PracticeContext {
  readonly states: ReadonlyMap<WordId, ReviewState>
  readonly flags: ReadonlyMap<WordId, WordFlag>
  /** Words a later pack retired (spec §5.1): `Corpus.retired`. */
  readonly retired: ReadonlySet<WordId>
  /**
   * Practice that takes its scope whole (`scopePool`): a theme, or a unit of a level the learner skipped. All the
   * scope's live words may be used, started or not. Absent everywhere else.
   */
  readonly unstarted?: boolean
}

/**
 * Whether practice may use a word (spec §7.4): started, and live — neither set aside nor retired. In a scope that
 * is practised whole (`unstarted`) a live word need not be started. The one rule behind every practice pool and
 * every "can this be practised" check; `unitPractisable` counts the same words of a unit.
 */
export function practisable(wordId: WordId, ctx: PracticeContext): boolean {
  return (ctx.unstarted === true || ctx.states.has(wordId)) && isLive(wordId, ctx)
}

/** What practice keeps to when it is not over everything (spec §7.4): one unit of the path, or one theme. */
export interface PracticeScope {
  readonly kind: 'unit' | 'theme'
  /** The unit's or the theme's ID. */
  readonly id: string
}

/** What a scoped practice draws from. */
export interface ScopePool {
  /** The words of the unit or theme. */
  readonly within: ReadonlySet<WordId>
  /** The scope is practised whole: all its live words are used, started or not, and none is started by it. */
  readonly unstarted: boolean
}

/**
 * The words of the unit or theme being practised, and whether the never-started ones are among them (spec §7.4):
 * a theme is practised whole, and so is a unit of a level the learner skipped (§7.2), whose words are never
 * introduced; any other unit keeps to its started words. Undefined for practice over everything, and for a unit
 * or theme the corpus does not hold. The one place that decides it.
 */
export function scopePool(corpus: Corpus | null, declaredLevel: CefrLevel, scope: PracticeScope | undefined): ScopePool | undefined {
  if (!scope || !corpus) return undefined
  if (scope.kind === 'unit') {
    const unit = corpus.units.find((u) => u.unitId === scope.id)
    return unit && { within: new Set(unit.wordIds), unstarted: isSkippedLevel(unit.level, declaredLevel) }
  }
  if (!corpus.themes.some((t) => t.themeId === scope.id)) return undefined
  return { within: new Set(themeEntries(corpus, scope.id).map((e) => corpusWordId(e.entryId))), unstarted: true }
}

export interface PracticeInput extends PracticeContext {
  /** Words the schedule serves now; practising them would only duplicate the session, so they are used only when nothing else is left. */
  readonly exclude: ReadonlySet<WordId>
  /** Practising one unit or theme: its words, and the run keeps to them. Absent for practice over everything. */
  readonly within?: ReadonlySet<WordId>
  /** Words this visit has already shown in the scope: the others are drawn first (`pickUnseenFirst`). Absent for practice over everything. */
  readonly shown?: ReadonlySet<WordId>
  readonly count: number
  readonly rng: Rng
}

/**
 * The words a practice run may draw now (spec §7.4): introduced, not flagged, not retired, not in today's
 * session — unless that leaves nothing, when the session's words are used after all: practice never touches the
 * schedule, and a repeat is better than a run with nothing in it. With `unstarted`, the words of `within` that
 * were never started are among them.
 */
export function practiceCandidates(input: Omit<PracticeInput, 'count' | 'rng' | 'shown'>): WordId[] {
  const { within, states } = input
  // Unstarted words have no state to be listed by: they come from the unit or theme itself.
  const pool = input.unstarted && within ? [...within] : [...states.keys()].filter((id) => !within || within.has(id))
  const usable = pool.filter((id) => practisable(id, { ...input, unstarted: input.unstarted === true && within !== undefined }))
  const outside = usable.filter((id) => !input.exclude.has(id))
  return outside.length > 0 ? outside : usable
}

/**
 * Words for extra practice (spec §7.4): `count` of `practiceCandidates`. The draw leans towards weaker words
 * (`practiceWeight`) and never repeats one; a never-started word is drawn at the base weight. Given what the
 * visit has `shown`, the words not yet shown are drawn first.
 */
export function practiceWords(input: PracticeInput): WordId[] {
  return pickUnseenFirst(practiceCandidates(input), input.shown ?? new Set(), input.count, (id) => practiceWeight(input.states.get(id)), input.rng)
}

/**
 * What a matching board may use (spec §8.1): introduced, live corpus words; those of `within` when practising one
 * unit or theme, and with `unstarted` (a scope practised whole) all its live words.
 */
export function matchingCandidates(
  corpus: Corpus,
  states: ReadonlyMap<WordId, ReviewState>,
  flags: ReadonlyMap<WordId, WordFlag>,
  within?: ReadonlySet<WordId>,
  unstarted = false,
): CorpusEntry[] {
  return [...corpus.entries.values()].filter((e) => {
    const wordId = corpusWordId(e.entryId)
    if (within && !within.has(wordId)) return false
    return !e.retired && practisable(wordId, { states, flags, retired: corpus.retired, unstarted: unstarted && within !== undefined })
  })
}
