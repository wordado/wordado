import type { Grade, MasteryTier, Mode, PartOfSpeech } from '@wordado/core'
import type { MessageKey } from './i18n/i18n'

export const TIER_LABEL: Readonly<Record<MasteryTier, MessageKey>> = {
  new: 'tier.new',
  learning: 'tier.learning',
  young: 'tier.young',
  mature: 'tier.mature',
}

export const MODE_LABEL: Readonly<Record<Mode, MessageKey>> = {
  flashcard: 'mode.flashcard',
  multiple_choice: 'mode.multiple_choice',
  listening_select: 'mode.listening_select',
  matching: 'mode.matching',
}

export const GRADE_LABEL: Readonly<Record<Grade, MessageKey>> = { 1: 'grade.1', 2: 'grade.2', 3: 'grade.3', 4: 'grade.4' }

export const POS_LABEL: Readonly<Record<PartOfSpeech, MessageKey>> = {
  noun: 'pos.noun',
  verb: 'pos.verb',
  adj: 'pos.adj',
  adv: 'pos.adv',
  pron: 'pos.pron',
  prep: 'pos.prep',
  det: 'pos.det',
  num: 'pos.num',
  conj: 'pos.conj',
  intj: 'pos.intj',
  phrase: 'pos.phrase',
}
