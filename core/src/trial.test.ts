import { describe, expect, it } from 'vitest'
import type { Corpus } from './corpus'
import { computeUnlocks, currentUnit, earnedUnlocks, pathNewWords, type PathContext } from './path'
import { studyUnits, trialFinished } from './trial'
import type { CefrLevel, Unit } from './types'
import { corpusWordId } from './wordId'

const w = (n: number) => corpusWordId(`en-${String(n).padStart(6, '0')}`)
const unit = (unitId: string, level: CefrLevel, order: number, ids: number[]): Unit => ({
  unitId,
  level,
  order,
  title: { en: unitId, l1: unitId },
  wordIds: ids.map(w),
})

const UNITS = [unit('a1-u1', 'A1', 1, [1, 2]), unit('a2-u1', 'A2', 2, [3, 4]), unit('b1-u1', 'B1', 3, [5, 6]), unit('c1-u1', 'C1', 4, [7, 8])]

const corpusOf = (units: readonly Unit[], trial: Corpus['trial']): Corpus => ({
  l1: 'bg',
  entries: new Map(),
  units,
  themes: [],
  clips: new Map(),
  retired: new Set(),
  trial,
})
const course = corpusOf(UNITS, null)
const trial = corpusOf(UNITS, { probes: [], course: {}, themes: {} })

function ctx(corpus: Corpus, declaredLevel: CefrLevel, introduced: number[] = []): PathContext {
  return {
    units: studyUnits(corpus, declaredLevel),
    retired: new Set(),
    flags: new Map(),
    introduced: new Set(introduced.map(w)),
    declaredLevel,
    unlocked: new Set(),
  }
}

describe('studyUnits', () => {
  it('is every unit of a course, in order', () => {
    expect(studyUnits(course, 'B1')).toEqual(UNITS)
  })

  it("is the declared level's unit only for a trial", () => {
    expect(studyUnits(trial, 'B1').map((u) => u.unitId)).toEqual(['b1-u1'])
  })

  it('is empty when the trial has no unit at the declared level', () => {
    expect(studyUnits(corpusOf([UNITS[0]!, UNITS[2]!], { probes: [], course: {}, themes: {} }), 'A2')).toEqual([])
  })
})

describe('the path over a trial', () => {
  it("offers the declared level's words, and nothing once they are introduced", () => {
    const start = ctx(trial, 'B1')
    expect(currentUnit(start)?.unitId).toBe('b1-u1')
    expect(pathNewWords(start, 10)).toEqual([w(5), w(6)])

    const done = ctx(trial, 'B1', [5, 6])
    expect(currentUnit(done)).toBeNull()
    expect(pathNewWords(done, 10)).toEqual([])
    expect(earnedUnlocks(done)).toEqual([])
    expect(computeUnlocks(done)).toEqual(['b1-u1'])
  })
})

describe('trialFinished', () => {
  it('is never true for a course', () => {
    expect(trialFinished(course, null)).toBe(false)
    expect(trialFinished(course, 'a1-u1')).toBe(false)
  })

  it('is true for a trial with no current unit, false with one', () => {
    expect(trialFinished(trial, null)).toBe(true)
    expect(trialFinished(trial, 'b1-u1')).toBe(false)
  })
})
