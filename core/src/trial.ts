import type { Corpus } from './corpus'
import type { CefrLevel, Unit } from './types'

/** The units study and the path screen keep to: every unit of a course; of a trial, the declared level's (spec 2026-10-12 §4.4). */
export function studyUnits(corpus: Corpus, declaredLevel: CefrLevel): readonly Unit[] {
  if (corpus.trial === null) return corpus.units
  return corpus.units.filter((unit) => unit.level === declaredLevel)
}

/** A trial whose unit has no live word left to start, given the path's current unit (null: none). */
export function trialFinished(corpus: Corpus, currentUnitId: string | null): boolean {
  return corpus.trial !== null && currentUnitId === null
}
