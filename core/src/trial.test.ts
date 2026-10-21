import { describe, expect, it } from 'vitest'
import type { Corpus } from './corpus'
import { computeUnlocks, currentUnit, earnedUnlocks, pathNewWords, type PathContext } from './path'
import { openThemeLeft, pathUnits, studyUnits, trialFinished } from './trial'
import type { CefrLevel, CorpusEntry, Unit, WordFlag } from './types'
import { corpusWordId, type WordId } from './wordId'

const w = (n: number) => corpusWordId(`en-${String(n).padStart(6, '0')}`)
const NO_FLAGS = new Map<WordId, WordFlag>()
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
  target: 'en',
  entries: new Map(),
  units,
  themes: [],
  clips: new Map(),
  retired: new Set(),
  notTaught: new Set(),
  trial,
})
const course = corpusOf(UNITS, null)
const trial = corpusOf(UNITS, { probes: [], course: {}, themes: {}, openTheme: null })

function ctx(corpus: Corpus, declaredLevel: CefrLevel, introduced: number[] = []): PathContext {
  return {
    units: studyUnits(corpus, declaredLevel),
    retired: new Set(),
    notTaught: new Set(),
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
    expect(studyUnits(corpusOf([UNITS[0]!, UNITS[2]!], { probes: [], course: {}, themes: {}, openTheme: null }), 'A2')).toEqual([])
  })
})

describe('pathUnits', () => {
  it('is the units study keeps to, but one with no word the course teaches (issue #288)', () => {
    const quiet = { ...course, retired: new Set([w(3)]), notTaught: new Set([w(4), w(5)]) }
    expect(pathUnits(quiet, 'A1').map((u) => u.unitId)).toEqual(['a1-u1', 'b1-u1', 'c1-u1'])
    expect(pathUnits(course, 'A1')).toEqual(UNITS)
    expect(pathUnits({ ...trial, notTaught: new Set([w(5), w(6)]) }, 'B1')).toEqual([])
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

const themed = (n: number, taught = true): CorpusEntry => ({
  entryId: `en-${String(n).padStart(6, '0')}`,
  headword: `w${n}`,
  variants: [],
  pos: 'noun',
  sense: '',
  level: 'A1',
  ipa: '',
  unitId: 'a1-u1',
  themes: ['food'],
  translations: [`t${n}`],
  examples: [],
  audio: {},
  retired: false,
  taught,
  grammar: null,
})
const open = (entries: CorpusEntry[]): Corpus => ({
  ...corpusOf(UNITS, { probes: [], course: {}, themes: {}, openTheme: 'food' }),
  entries: new Map(entries.map((e) => [e.entryId, e])),
})

describe('trialFinished', () => {
  it('is never true for a course', () => {
    expect(trialFinished(course, null, null, new Set(), NO_FLAGS)).toBe(false)
    expect(trialFinished(course, 'a1-u1', null, new Set(), NO_FLAGS)).toBe(false)
  })

  it('is true for a trial with no current unit, false with one', () => {
    expect(trialFinished(trial, null, null, new Set(), NO_FLAGS)).toBe(true)
    expect(trialFinished(trial, 'b1-u1', null, new Set(), NO_FLAGS)).toBe(false)
  })

  it('a chosen open theme with words left holds the end back', () => {
    const corpus = open([themed(1), themed(2)])
    expect(trialFinished(corpus, null, 'food', new Set([w(1)]), NO_FLAGS)).toBe(false)
  })

  it('an unchosen open theme does not hold the end back', () => {
    const corpus = open([themed(1), themed(2)])
    expect(trialFinished(corpus, null, null, new Set(), NO_FLAGS)).toBe(true)
    expect(trialFinished(corpus, null, 'travel', new Set(), NO_FLAGS)).toBe(true)
  })

  it('a chosen open theme with every word started lets the demo end', () => {
    const corpus = open([themed(1), themed(2), themed(3, false)])
    expect(trialFinished(corpus, null, 'food', new Map([[w(1), 1], [w(2), 1]]), NO_FLAGS)).toBe(true)
  })

  it('words the learner set aside do not hold the end back', () => {
    const corpus = open([themed(1), themed(2), themed(3)])
    const flags = new Map<WordId, WordFlag>([[w(2), 'known'], [w(3), 'suspended']])
    expect(trialFinished(corpus, null, 'food', new Set([w(1)]), flags)).toBe(true)
    expect(trialFinished(corpus, null, 'food', new Set([w(1)]), new Map([[w(2), 'known']]))).toBe(false)
  })

  it('a course is never finished', () => {
    expect(trialFinished(course, null, 'food', new Set(), NO_FLAGS)).toBe(false)
  })
})

describe('openThemeLeft', () => {
  it('is false without an open theme', () => {
    expect(openThemeLeft(course, new Set(), NO_FLAGS)).toBe(false)
    expect(openThemeLeft(trial, new Set(), NO_FLAGS)).toBe(false)
  })

  it('counts only taught words not yet started', () => {
    const corpus = open([themed(1), themed(2, false)])
    expect(openThemeLeft(corpus, new Set(), NO_FLAGS)).toBe(true)
    expect(openThemeLeft(corpus, new Set([w(1)]), NO_FLAGS)).toBe(false)
  })

  it('skips words the learner set aside', () => {
    const corpus = open([themed(1), themed(2)])
    expect(openThemeLeft(corpus, new Set(), new Map([[w(1), 'known'], [w(2), 'suspended']]))).toBe(false)
    expect(openThemeLeft(corpus, new Set(), new Map([[w(1), 'known']]))).toBe(true)
  })
})
