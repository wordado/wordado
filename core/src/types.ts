import type { WordId } from './wordId'

/** FSRS grades. The numeric values are the ones FSRS uses. */
export const Grade = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const
export type Grade = (typeof Grade)[keyof typeof Grade]

/** Phase 1 game modes (spec §8.1). Phase 2 adds typing, cloze and listening_type. */
export type Mode = 'flashcard' | 'multiple_choice' | 'listening_select' | 'matching'

export type Direction = 'en_to_l1' | 'l1_to_en'

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const
export type CefrLevel = (typeof CEFR_LEVELS)[number]

export function levelIndex(level: CefrLevel): number {
  return CEFR_LEVELS.indexOf(level)
}

/** A learner's per-word flag (spec §7.4). */
export type WordFlag = 'known' | 'suspended'

/** Part-of-speech tags a pack may use (spec §5.2). */
export const PARTS_OF_SPEECH = [
  'noun',
  'verb',
  'adj',
  'adv',
  'pron',
  'prep',
  'det',
  'num',
  'conj',
  'intj',
  'phrase',
] as const
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number]

/** Audio accents a pack may carry per entry (spec §5.2). */
export type Accent = 'uk' | 'us'

/** Text shipped in a pack in English and in the pack's L1: unit titles, theme names (spec §8.9). */
export interface LocalizedText {
  readonly en: string
  readonly l1: string
}

/** One sense of a headword, as `core` sees it, for one L1 (spec §5.2). */
export interface CorpusEntry {
  /** Stable ID, without the `c:` prefix. */
  readonly entryId: string
  readonly headword: string
  readonly pos: string
  readonly level: CefrLevel
  readonly ipa: string
  /** A back-reference to the entry's unit; the pack validator keeps it consistent with Unit.wordIds. */
  readonly unitId: string
  readonly themes: readonly string[]
  /** Primary translation first, then accepted alternates. */
  readonly translations: readonly string[]
  readonly retired: boolean
}

/** A unit of the level path (spec §7.2). */
export interface Unit {
  readonly unitId: string
  readonly level: CefrLevel
  /** Position in the path. Unique; lower comes first. */
  readonly order: number
  /** The source of truth for unit membership and order; CorpusEntry.unitId is the back-reference. */
  readonly wordIds: readonly WordId[]
}

/**
 * One answer, as the client records it (spec §6.2). Times are epoch
 * milliseconds. Server-assigned fields live on StampedReviewEvent.
 * Deliberately without a user_id: `core` always works on one learner's events.
 */
export interface ReviewEvent {
  readonly reviewId: string
  readonly wordId: WordId
  readonly mode: Mode
  /** By convention `'en_to_l1'` for listening and matching. */
  readonly direction: Direction
  readonly grade: Grade
  readonly latencyMs: number
  readonly practice: boolean
  readonly clientTs: number
  /**
   * Minutes to ADD to UTC for the learner's local time at the moment of the
   * answer (UTC+2 is `120`): the NEGATION of `Date.prototype.getTimezoneOffset()`.
   */
  readonly clientTzOffsetMin: number
  readonly deviceId: string
  readonly deviceSeq: number
  readonly schedulerVersion: string
}

export interface StampedReviewEvent extends ReviewEvent {
  readonly receivedAt: number
  /** Immutable once assigned (spec §9.2). */
  readonly effectiveTs: number
  readonly xpEligible: boolean
}
