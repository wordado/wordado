import { describe, expect, it } from 'vitest'
import { selectLive, senseRank, type SelectCandidate } from './select'

const c = (entry_id: string, level: 'A1' | 'A2' | 'B2', rank: number, extra: Partial<SelectCandidate> = {}): SelectCandidate => ({
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
