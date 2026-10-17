import { themeEntries, type Corpus } from './corpus'
import { hasTaughtWord } from './path'
import type { CefrLevel, Unit } from './types'
import { corpusWordId, type WordId } from './wordId'

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

/** The open theme of a trial has a taught, live word the learner has not started; false for a course or a trial without one (#290). */
export function openThemeLeft(corpus: Corpus, introduced: ReadonlySet<WordId> | ReadonlyMap<WordId, unknown>): boolean {
  const theme = corpus.trial?.openTheme ?? null
  if (theme === null) return false
  return themeEntries(corpus, theme).some((e) => e.taught && !introduced.has(corpusWordId(e.entryId)))
}

/**
 * A trial whose unit has no live word left to start, given the path's current unit (null: none). Not while the
 * learner has the open theme chosen and words of it are left: the demo goes on with them (#290).
 */
export function trialFinished(corpus: Corpus, currentUnitId: string | null, activeTheme: string | null, introduced: ReadonlySet<WordId> | ReadonlyMap<WordId, unknown>): boolean {
  if (corpus.trial === null || currentUnitId !== null) return false
  return !(activeTheme !== null && activeTheme === corpus.trial.openTheme && openThemeLeft(corpus, introduced))
}
