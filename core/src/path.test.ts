import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { assumedKnownWords, computeUnlocks, currentUnit, pathNewWords, type PathContext } from './path'
import type { CefrLevel, Unit, WordFlag } from './types'
import { corpusWordId, type WordId } from './wordId'

const w = (n: number) => corpusWordId(`en-${String(n).padStart(6, '0')}`)
const unit = (unitId: string, level: CefrLevel, order: number, ids: number[]): Unit => ({
  unitId,
  level,
  order,
  wordIds: ids.map(w),
})

const UNITS = [
  unit('a1-u1', 'A1', 1, [1, 2, 3]),
  unit('a1-u2', 'A1', 2, [4, 5, 6]),
  unit('a2-u1', 'A2', 3, [7, 8, 9]),
  unit('a2-u2', 'A2', 4, [10, 11, 12]),
]

function ctx(over: Partial<PathContext> = {}): PathContext {
  return {
    units: UNITS,
    retired: new Set(),
    flags: new Map(),
    introduced: new Set(),
    declaredLevel: 'A1',
    unlocked: new Set(),
    ...over,
  }
}

describe('computeUnlocks', () => {
  it('unlocks the first unit for a new A1 learner', () => {
    expect(computeUnlocks(ctx())).toEqual(['a1-u1'])
  })

  it('unlocks the successor once every word of the unit is introduced', () => {
    const base = { unlocked: new Set(['a1-u1']) }
    expect(computeUnlocks(ctx({ ...base, introduced: new Set([w(1), w(2)]) }))).toEqual([])
    expect(computeUnlocks(ctx({ ...base, introduced: new Set([w(1), w(2), w(3)]) }))).toEqual(['a1-u2'])
  })

  it('does not wait for retired, known or suspended words', () => {
    const c = ctx({
      unlocked: new Set(['a1-u1']),
      introduced: new Set([w(1)]),
      retired: new Set([w(2)]),
      flags: new Map<WordId, WordFlag>([[w(3), 'suspended']]),
    })
    expect(computeUnlocks(c)).toEqual(['a1-u2'])
  })

  it('chains through a unit with no live words left', () => {
    const c = ctx({
      unlocked: new Set(['a1-u1']),
      introduced: new Set([w(1), w(2), w(3)]),
      flags: new Map<WordId, WordFlag>([[w(4), 'known'], [w(5), 'known'], [w(6), 'known']]),
    })
    expect(computeUnlocks(c)).toEqual(['a1-u2', 'a2-u1'])
  })

  it('unlocks everything below the declared level, plus the first unit at it', () => {
    expect(computeUnlocks(ctx({ declaredLevel: 'A2' }))).toEqual(['a1-u1', 'a1-u2', 'a2-u1'])
  })

  it('counts a word pulled forward by a collection toward its unit', () => {
    const c = ctx({ unlocked: new Set(['a1-u1']), introduced: new Set([w(1), w(2), w(3), w(4), w(5), w(6)]) })
    expect(computeUnlocks(c)).toEqual(['a1-u2', 'a2-u1'])
  })

  it('never proposes removing an unlock', () => {
    const c = ctx({ declaredLevel: 'A1', unlocked: new Set(['a1-u1', 'a1-u2', 'a2-u1']) })
    expect(computeUnlocks(c)).toEqual([])
  })
})

describe('currentUnit and pathNewWords', () => {
  it('skips assumed-known units', () => {
    const c = ctx({ declaredLevel: 'A2', unlocked: new Set(['a1-u1', 'a1-u2', 'a2-u1']) })
    expect(currentUnit(c)?.unitId).toBe('a2-u1')
    expect(pathNewWords(c, 10).slice(0, 3)).toEqual([w(7), w(8), w(9)])
    expect(assumedKnownWords(c)).toEqual(new Set([w(1), w(2), w(3), w(4), w(5), w(6)]))
  })

  it('returns never-introduced words to the queue when the level is lowered', () => {
    const c = ctx({
      declaredLevel: 'A1',
      unlocked: new Set(['a1-u1', 'a1-u2', 'a2-u1']),
      introduced: new Set([w(7)]),
    })
    expect(currentUnit(c)?.unitId).toBe('a1-u1')
    expect(assumedKnownWords(c).size).toBe(0)
  })

  it('runs on into the next unit, so a session is not cut short at a unit boundary', () => {
    const c = ctx({ unlocked: new Set(['a1-u1']), introduced: new Set([w(1), w(2)]) })
    expect(pathNewWords(c, 3)).toEqual([w(3), w(4), w(5)])
  })

  it('drains each unit before starting the next, so every offered word is unlocked by the time it is reached', () => {
    const c = ctx({ unlocked: new Set(['a1-u1']), introduced: new Set([w(1), w(2)]), retired: new Set([w(5)]) })
    const offered = pathNewWords(c, 100)
    expect(offered).toEqual([w(3), w(4), w(6), w(7), w(8), w(9), w(10), w(11), w(12)])
    // Introduce the words in the order offered: the unlock rule has always opened a word's unit first.
    const unlocked = new Set(c.unlocked)
    const introduced = new Set(c.introduced)
    for (const id of offered) {
      for (const unitId of computeUnlocks({ ...c, unlocked, introduced })) unlocked.add(unitId)
      const home = UNITS.find((u) => u.wordIds.includes(id))
      expect(home && unlocked.has(home.unitId)).toBe(true)
      introduced.add(id)
    }
  })

  it('respects the limit and skips words that are not live', () => {
    const c = ctx({ unlocked: new Set(['a1-u1']), retired: new Set([w(2)]) })
    expect(pathNewWords(c, 2)).toEqual([w(1), w(3)])
    expect(pathNewWords(c, 0)).toEqual([])
  })

  it('is empty when the path is finished', () => {
    const c = ctx({
      unlocked: new Set(UNITS.map((u) => u.unitId)),
      introduced: new Set(UNITS.flatMap((u) => u.wordIds)),
    })
    expect(currentUnit(c)).toBeNull()
    expect(pathNewWords(c, 10)).toEqual([])
  })
})

describe('the new-word queue never runs dry (spec §13)', () => {
  const allWords = UNITS.flatMap((u) => u.wordIds)
  const subset = fc.subarray(allWords)

  it('always offers a word while any live, never-introduced word remains on the path', () => {
    fc.assert(
      fc.property(
        subset,
        subset,
        subset,
        fc.constantFrom<CefrLevel>('A1', 'A2'),
        (introduced, retired, flagged, declaredLevel) => {
          // Walk the path the way a learner does: apply unlocks, study what is offered, repeat.
          const c0 = ctx({
            declaredLevel,
            retired: new Set(retired),
            flags: new Map(flagged.map((id): [WordId, WordFlag] => [id, 'known'])),
          })
          const unlocked = new Set<string>()
          const seen = new Set<WordId>(introduced)
          for (let step = 0; step < 50; step += 1) {
            const c = { ...c0, unlocked, introduced: seen }
            for (const id of computeUnlocks(c)) unlocked.add(id)
            const next = pathNewWords({ ...c, unlocked }, 2)
            if (next.length === 0) break
            for (const id of next) seen.add(id)
          }
          const final = { ...c0, unlocked, introduced: seen }
          const left = UNITS.filter((u) => declaredLevel === 'A1' || u.level !== 'A1')
            .flatMap((u) => u.wordIds)
            .filter((id) => !final.retired.has(id) && !final.flags.has(id) && !seen.has(id))
          expect(left).toEqual([])
        },
      ),
    )
  })
})
