import { describe, expect, it } from 'vitest'
import { selectLive, senseRank, type SelectCandidate } from './select'

const c = (entry_id: string, level: 'A1' | 'A2' | 'B1' | 'B2', rank: number, extra: Partial<SelectCandidate> = {}): SelectCandidate => ({
  entry_id, level, rank, order: 0, pinned: false, wasLive: false, dropped: false, ...extra,
})
const targets = { A1: 2, A2: 1, B1: 1, B2: 1, C1: 1 }

describe('selectLive (Decision 9)', () => {
  it('fills each shipped level by rank up to its target', () => {
    expect([...selectLive([c('a', 'A1', 3), c('b', 'A1', 1), c('c', 'A1', 2), c('d', 'A2', 5), c('e', 'B2', 1)], ['A1', 'A2'], targets)].sort()).toEqual(['b', 'c', 'd'])
  })

  it('keeps pinned and previously live entries even past the target, and counts them toward it', () => {
    const out = selectLive([c('a', 'A1', 1), c('b', 'A1', 2), c('p', 'A1', 900, { pinned: true }), c('w', 'A1', 800, { wasLive: true })], ['A1'], targets)
    expect([...out].sort()).toEqual(['p', 'w'])
  })

  it('leaves out a dropped entry, even a pinned or previously live one', () => {
    expect([...selectLive([c('p', 'A1', 1, { pinned: true, dropped: true }), c('w', 'A1', 2, { wasLive: true, dropped: true })], ['A1'], targets)]).toEqual([])
  })

  it('breaks rank ties by sense order, then ID', () => {
    expect([...selectLive([c('y', 'A1', 1, { order: 1 }), c('x', 'A1', 1, { order: 1 }), c('z', 'A1', 1, { order: 0 })], ['A1'], targets)]).toEqual(['z', 'x'])
  })
})

describe('senseRank', () => {
  it('ranks a word’s first sense at the word’s frequency and each later sense as if the word were three times rarer', () => {
    expect([0, 1, 2, 3].map((order) => senseRank(100, order))).toEqual([100, 300, 900, 2700])
  })

  it('lets another word’s main sense take the slot a common word’s rare sense would have taken', () => {
    // "title" (rank 900) has a rare legal sense (order 2); "harbour" (rank 2000) has only its main sense.
    const cands = [
      { entry_id: 'title-2', level: 'B1' as const, rank: senseRank(900, 2), order: 2, pinned: false, wasLive: false, dropped: false },
      { entry_id: 'harbour-1', level: 'B1' as const, rank: senseRank(2000, 0), order: 0, pinned: false, wasLive: false, dropped: false },
    ]
    expect([...selectLive(cands, ['B1'], { A1: 1, A2: 1, B1: 1, B2: 1, C1: 1 })]).toEqual(['harbour-1'])
  })
})

describe('selectLive with main_meanings and sizes (spec 2026-10-06 §3.3)', () => {
  const sizes = { A1: 1, A2: 1, B1: 2, B2: 1, C1: 1 }

  it('takes every main meaning of an "all" level, whatever the size', () => {
    const out = selectLive([c('a', 'A1', 1), c('b', 'A1', 2), c('z', 'A1', 9000)], ['A1'], sizes, { A1: 'all' })
    expect([...out].sort()).toEqual(['a', 'b', 'z'])
  })

  it('takes a bounded level’s main meanings up to the rank, then fills by frequency to the size', () => {
    // m1 and m2 are within rank 100. f is past it: it comes in only while the size has room.
    const cands = [c('m1', 'B1', 50), c('m2', 'B1', 100), c('f', 'B1', 101)]
    expect([...selectLive(cands, ['B1'], sizes, { B1: 100 })].sort()).toEqual(['m1', 'm2'])
    expect([...selectLive(cands, ['B1'], { ...sizes, B1: 3 }, { B1: 100 })].sort()).toEqual(['f', 'm1', 'm2'])
  })

  it('does not count a later meaning as a main meaning, even inside the bound', () => {
    const cands = [c('w-1', 'A2', 10), c('w-2', 'A2', 30, { order: 1 }), c('v-2', 'A2', 20, { order: 1 })]
    // The main meaning fills A2's size of 1, so neither later meaning comes in.
    expect([...selectLive(cands, ['A2'], sizes, { A2: 'all' })]).toEqual(['w-1'])
  })

  it('keeps a dropped main meaning out, and leaves a level without a rule to the frequency fill', () => {
    expect([...selectLive([c('d', 'A1', 1, { dropped: true }), c('k', 'A1', 2)], ['A1'], sizes, { A1: 'all' })]).toEqual(['k'])
    expect([...selectLive([c('a', 'A2', 1), c('b', 'A2', 2)], ['A2'], sizes, { A1: 'all' })]).toEqual(['a'])
  })

  it('never removes a previously live entry when the size is smaller than what was live', () => {
    const cands = [c('w1', 'B2', 5, { wasLive: true }), c('w2', 'B2', 6, { wasLive: true }), c('n', 'B2', 1)]
    expect([...selectLive(cands, ['B2'], sizes)].sort()).toEqual(['w1', 'w2'])
  })

  it('gives the same course when it is run on its own result', () => {
    const cands = [c('a', 'A1', 1), c('b', 'A1', 2), c('m', 'B1', 40), c('f', 'B1', 400), c('g', 'B1', 500)]
    const rules = { A1: 'all' as const, B1: 100 }
    const first = selectLive(cands, ['A1', 'B1'], sizes, rules)
    expect([...first].sort()).toEqual(['a', 'b', 'f', 'm'])
    const second = selectLive(cands.map((x) => ({ ...x, wasLive: first.has(x.entry_id) })), ['A1', 'B1'], sizes, rules)
    expect([...second].sort()).toEqual([...first].sort())
  })
})
