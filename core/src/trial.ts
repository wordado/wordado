import type { Corpus } from './corpus'
import { hasTaughtWord } from './path'
import type { CefrLevel, Unit } from './types'

/** The units study and the path screen keep to: every unit of a course; of a trial, the declared level's (spec 2026-10-12 §4.4). */
export function studyUnits(corpus: Corpus, declaredLevel: CefrLevel): readonly Unit[] {
  if (corpus.trial === null) return corpus.units
  return corpus.units.filter((unit) => unit.level === declaredLevel)
}

/**
 * The units the path screen lists: those of `studyUnits` with a word the course teaches (issue #288). A unit whose
 * words are all retired or known from the start stays in `studyUnits`, done for the unlock rules, and is not shown.
 */
export function pathUnits(corpus: Corpus, declaredLevel: CefrLevel): readonly Unit[] {
  return studyUnits(corpus, declaredLevel).filter((unit) => hasTaughtWord(unit, corpus))
}

/** A trial whose unit has no live word left to start, given the path's current unit (null: none). */
export function trialFinished(corpus: Corpus, currentUnitId: string | null): boolean {
  return corpus.trial !== null && currentUnitId === null
}
