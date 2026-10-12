import { describe, expect, it } from 'vitest'
import { MIN_PLACEMENT_LEVELS, nextPlacementWords, placementCorpus, PLACEMENT_PASS_MIN, PLACEMENT_PROBE_SIZE, placementLevels, placementPool, placementProgress, type PlacementAnswer } from './placement'
import type { Corpus } from './corpus'
import { seededRng } from './rng'
import { CEFR_LEVELS, type CefrLevel, type CorpusEntry } from './types'
import { corpusWordId, type WordId } from './wordId'

const pool = new Map<CefrLevel, readonly WordId[]>(
  CEFR_LEVELS.map((level, i) => [level, Array.from({ length: 12 }, (_, k) => corpusWordId(`${level}-${i * 100 + k}`))]),
)

/** Answers the whole probe of `level`, `right` of them correctly, using the pool's words in order. */
function probe(level: CefrLevel, right: number, from: PlacementAnswer[] = [], levels: readonly CefrLevel[] = CEFR_LEVELS): PlacementAnswer[] {
  const words = pool.get(level)!
  const out = [...from]
  for (let i = 0; i < PLACEMENT_PROBE_SIZE; i += 1) {
    if (placementProgress(out, levels).probing !== level) break
    out.push({ wordId: words[i]!, level, correct: i < right })
  }
  return out
}

describe('placementProgress', () => {
  it('starts in the middle band with a whole probe to answer', () => {
    expect(placementProgress([])).toEqual({ probing: 'B1', remainingInProbe: PLACEMENT_PROBE_SIZE, result: null })
  })

  it('places a learner who passes every band at the highest', () => {
    const answers = probe('B2', 8, probe('B1', 8))
    expect(placementProgress(answers)).toEqual({ probing: null, remainingInProbe: 0, result: 'C1' })
  })

  it('places a learner at the lowest band they fail', () => {
    expect(placementProgress(probe('B2', 3, probe('B1', 8))).result).toBe('B2')
    expect(placementProgress(probe('A2', 7, probe('B1', 2))).result).toBe('B1')
    expect(placementProgress(probe('A1', 6, probe('A2', 5, probe('B1', 0)))).result).toBe('A2')
    expect(placementProgress(probe('A1', 1, probe('A2', 1, probe('B1', 1)))).result).toBe('A1')
  })

  it('decides a probe as soon as it can, so the test stays short', () => {
    const b1 = pool.get('B1')!
    const sixRight = b1.slice(0, PLACEMENT_PASS_MIN).map((wordId) => ({ wordId, level: 'B1' as const, correct: true }))
    expect(placementProgress(sixRight).probing).toBe('B2')
    const threeWrong = b1.slice(0, 3).map((wordId) => ({ wordId, level: 'B1' as const, correct: false }))
    expect(placementProgress(threeWrong).probing).toBe('A2')
    expect(placementProgress(threeWrong.slice(0, 2))).toEqual({ probing: 'B1', remainingInProbe: 6, result: null })
    expect(placementProgress(sixRight.slice(0, 4))).toEqual({ probing: 'B1', remainingInProbe: 4, result: null })
  })

  it('needs at most three probes', () => {
    for (const right of [0, 8]) {
      for (const right2 of [0, 8]) {
        for (const right3 of [0, 8]) {
          const answers = probe(placementProgress([]).probing!, right)
          const two = probe(placementProgress(answers).probing ?? 'A1', right2, answers)
          const three = placementProgress(two).probing === null ? two : probe(placementProgress(two).probing!, right3, two)
          expect(placementProgress(three).result).not.toBeNull()
          expect(three.length).toBeLessThanOrEqual(3 * PLACEMENT_PROBE_SIZE)
        }
      }
    }
  })

  it('rejects an answer from a band it is not probing', () => {
    expect(() => placementProgress([{ wordId: corpusWordId('x'), level: 'A1', correct: true }])).toThrow(/B1/)
  })
})

describe('nextPlacementWords', () => {
  it('draws unasked words from the band being probed, as many as the probe still needs', () => {
    const asked = probe('B1', 8).slice(0, 2)
    const next = nextPlacementWords(asked, pool, seededRng(1))
    expect(next).toHaveLength(placementProgress(asked).remainingInProbe)
    for (const id of next) {
      expect(pool.get('B1')).toContain(id)
      expect(asked.map((a) => a.wordId)).not.toContain(id)
    }
  })

  it('is reproducible for a seed and different across seeds', () => {
    expect(nextPlacementWords([], pool, seededRng(3))).toEqual(nextPlacementWords([], pool, seededRng(3)))
    expect(nextPlacementWords([], pool, seededRng(3))).not.toEqual(nextPlacementWords([], pool, seededRng(4)))
  })

  it('gives fewer when the band runs dry, and none once the test is decided', () => {
    const small = new Map<CefrLevel, readonly WordId[]>([['B1', [corpusWordId('only')]]])
    expect(nextPlacementWords([], small, seededRng(1))).toEqual([corpusWordId('only')])
    expect(nextPlacementWords(probe('B2', 8, probe('B1', 8)), pool, seededRng(1))).toEqual([])
  })
})

describe('placement over the bands a corpus ships (spec §7.2)', () => {
  const shipped: readonly CefrLevel[] = ['A1', 'A2', 'B1']

  it('starts in the middle of the shipped bands', () => {
    expect(placementProgress([], shipped)).toEqual({ probing: 'A2', remainingInProbe: PLACEMENT_PROBE_SIZE, result: null })
  })

  it('places at the highest shipped band once the middle passes, and probes A1 when the middle fails', () => {
    expect(placementProgress(probe('A2', 8, [], shipped), shipped)).toEqual({ probing: null, remainingInProbe: 0, result: 'B1' })
    const failA2 = pool.get('A2')!.slice(0, 3).map((wordId) => ({ wordId, level: 'A2' as const, correct: false }))
    expect(placementProgress(failA2, shipped).probing).toBe('A1')
  })

  it('draws the next words from the shipped band being probed', () => {
    const words = nextPlacementWords([], pool, seededRng(3), shipped)
    expect(words).toHaveLength(PLACEMENT_PROBE_SIZE)
    for (const w of words) expect(pool.get('A2')).toContain(w)
  })

  it('has nothing to probe with one band: that band is the result', () => {
    expect(placementProgress([], ['A1'])).toEqual({ probing: null, remainingInProbe: 0, result: 'A1' })
    expect(nextPlacementWords([], pool, seededRng(3), ['A1'])).toEqual([])
  })

  it('refuses an empty list of bands', () => {
    expect(() => placementProgress([], [])).toThrow()
  })
})

const entry = (entryId: string, level: CefrLevel, retired = false): CorpusEntry => ({
  entryId,
  headword: entryId,
  variants: [],
  pos: 'noun',
  sense: '',
  level,
  ipa: '',
  unitId: 'u',
  themes: [],
  translations: ['x'],
  examples: [],
  audio: {},
  retired,
})

describe('placementPool and placementLevels', () => {
  it('groups live entries by band, leaving retired ones out', () => {
    const got = placementPool([entry('a', 'A1'), entry('b', 'A1', true), entry('c', 'B1')])
    expect(got.get('A1')).toEqual(['c:a'])
    expect(got.get('B1')).toEqual(['c:c'])
    expect(got.has('A2')).toBe(false)
  })

  it('offers bands from A1 upward while each has a probe’s worth of words', () => {
    const many = (level: CefrLevel, n: number) => Array.from({ length: n }, (_, i) => entry(`${level}-${i}`, level))
    const full = placementPool([...many('A1', 8), ...many('A2', 8), ...many('B1', 8)])
    expect(placementLevels(full)).toEqual(['A1', 'A2', 'B1'])
    // A gap stops the list: B1 cannot be probed as the neighbour of an empty A2.
    const gap = placementPool([...many('A1', 8), ...many('A2', 7), ...many('B1', 8)])
    expect(placementLevels(gap)).toEqual(['A1'])
    expect(MIN_PLACEMENT_LEVELS).toBe(2)
  })
})

describe('placementCorpus', () => {
  const withExamples = (e: CorpusEntry): CorpusEntry => ({ ...e, examples: ['An example.'], unitId: 'u-b1' })
  const corpusOf = (entries: CorpusEntry[], trial: Corpus['trial']): Corpus => ({
    l1: 'bg',
    entries: new Map(entries.map((e) => [e.entryId, e])),
    units: [],
    themes: [],
    clips: new Map(),
    retired: new Set(),
    trial,
  })

  it('is the course itself for a course', () => {
    const corpus = corpusOf([entry('a', 'A1'), entry('b', 'B1')], null)
    const got = placementCorpus(corpus)
    expect(got.corpus).toBe(corpus)
    expect(got.pool).toEqual(placementPool(corpus.entries.values()))
  })

  it('draws a trial test from the probes only, by level', () => {
    const corpus = corpusOf([entry('unit-only', 'B1')], {
      probes: [entry('p1', 'A1'), entry('p2', 'A1'), entry('p3', 'C1'), entry('p4', 'C1', true)],
      course: {},
    })
    const { pool } = placementCorpus(corpus)
    expect(pool.get('A1')).toEqual([corpusWordId('p1'), corpusWordId('p2')])
    expect(pool.get('C1')).toEqual([corpusWordId('p3')])
    expect(pool.has('B1')).toBe(false)
  })

  it('lets a question show a probe or a unit entry, and keeps the unit entry where both exist', () => {
    const full = withExamples(entry('both', 'B1'))
    const corpus = corpusOf([full, entry('unit-only', 'B1')], { probes: [entry('both', 'B1'), entry('p', 'A1')], course: {} })
    const { corpus: merged } = placementCorpus(corpus)
    expect([...merged.entries.keys()].sort()).toEqual(['both', 'p', 'unit-only'])
    expect(merged.entries.get('both')).toBe(full)
    expect(merged.trial).toBe(corpus.trial)
  })
})
