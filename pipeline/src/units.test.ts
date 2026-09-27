import { describe, expect, it } from 'vitest'
import { assignUnits, inPathOrder, type UnitCandidate } from './units'

const c = (entry_id: string, level: 'A1' | 'A2', theme: string, rank: number): UnitCandidate => ({ entry_id, level, theme, rank, order: 0 })

describe('assignUnits (spec §7.2, Decision 9)', () => {
  it('leaves placed entries where they are and appends new units after a level’s last', () => {
    const units = [{ unit_id: 'a1-01', level: 'A1' as const, entry_ids: ['a'] }]
    const out = assignUnits(units, [c('a', 'A1', 'food', 1), c('b', 'A1', 'food', 2)], new Set(['a']), 20)
    expect(out).toEqual([
      { unit_id: 'a1-01', level: 'A1', entry_ids: ['a'] },
      { unit_id: 'a1-02', level: 'A1', entry_ids: ['b'] },
    ])
  })

  it('groups new words by theme, themes in order of their most frequent word, in units of the given size', () => {
    const live = [c('f1', 'A1', 'food', 5), c('h1', 'A1', 'home', 1), c('f2', 'A1', 'food', 6), c('h2', 'A1', 'home', 2), c('f3', 'A1', 'food', 7)]
    expect(assignUnits([], live, new Set(), 2).map((u) => u.entry_ids)).toEqual([['h1', 'h2'], ['f1', 'f2', 'f3']])
  })

  it('folds a last unit under half the size into the one before it', () => {
    const live = [1, 2, 3, 4, 5].map((r) => c(`w${r}`, 'A1', 'x', r))
    expect(assignUnits([], live, new Set(), 4).map((u) => u.entry_ids.length)).toEqual([5])
  })

  it('moves an entry whose level changed out of its unit, but keeps a retired published entry in place', () => {
    const units = [{ unit_id: 'a1-01', level: 'A1' as const, entry_ids: ['moved', 'retired', 'kept', 'never'] }]
    const out = assignUnits(units, [c('moved', 'A2', 'x', 1), c('kept', 'A1', 'x', 2)], new Set(['moved', 'retired', 'kept']), 20)
    expect(out).toEqual([
      { unit_id: 'a1-01', level: 'A1', entry_ids: ['retired', 'kept'] },
      { unit_id: 'a2-01', level: 'A2', entry_ids: ['moved'] },
    ])
  })

  it('never reuses a unit number, even of a unit that is now empty', () => {
    const units = [{ unit_id: 'a1-07', level: 'A1' as const, entry_ids: ['gone'] }]
    expect(assignUnits(units, [c('n', 'A1', 'x', 1)], new Set(), 20).map((u) => u.unit_id)).toEqual(['a1-07', 'a1-08'])
  })
})

describe('inPathOrder', () => {
  it('orders by level, then unit number', () => {
    const u = (unit_id: string, level: 'A1' | 'A2') => ({ unit_id, level, entry_ids: ['x'] })
    expect(inPathOrder([u('a2-01', 'A2'), u('a1-10', 'A1'), u('a1-02', 'A1')]).map((x) => x.unit_id)).toEqual(['a1-02', 'a1-10', 'a2-01'])
  })
})
