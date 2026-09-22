import { describe, expect, it } from 'vitest'
import { nextPlacementWords, PLACEMENT_PASS_MIN, PLACEMENT_PROBE_SIZE, placementProgress, type PlacementAnswer } from './placement'
import { seededRng } from './rng'
import { CEFR_LEVELS, type CefrLevel } from './types'
import { corpusWordId, type WordId } from './wordId'

const pool = new Map<CefrLevel, readonly WordId[]>(
  CEFR_LEVELS.map((level, i) => [level, Array.from({ length: 12 }, (_, k) => corpusWordId(`${level}-${i * 100 + k}`))]),
)

/** Answers the whole probe of `level`, `right` of them correctly, using the pool's words in order. */
function probe(level: CefrLevel, right: number, from: PlacementAnswer[] = []): PlacementAnswer[] {
  const words = pool.get(level)!
  const out = [...from]
  for (let i = 0; i < PLACEMENT_PROBE_SIZE; i += 1) {
    if (placementProgress(out).probing !== level) break
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
