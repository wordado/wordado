import { describe, expect, it } from 'vitest'
import type { PartOfSpeech } from '@wordado/core'
import { assignUnits, groupTitles, inPathOrder, type UnitCandidate } from './units'

const c = (entry_id: string, level: 'A1' | 'A2', theme: string, rank: number, pos: PartOfSpeech = 'noun'): UnitCandidate => ({
  entry_id, level, theme, pos, rank, order: 0,
})

describe('assignUnits (spec §7.2, Decision 9)', () => {
  it('leaves placed entries where they are and appends new units after a level’s last', () => {
    const units = [{ unit_id: 'a1-01', level: 'A1' as const, entry_ids: ['a'] }]
    const out = assignUnits(units, [c('a', 'A1', 'food', 1), c('b', 'A1', 'home', 2)], new Set(['a']), 20)
    expect(out).toEqual([
      { unit_id: 'a1-01', level: 'A1', entry_ids: ['a'] },
      { unit_id: 'a1-02', level: 'A1', entry_ids: ['b'], group: 'mixed' },
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

  it('at the real unit size (20), folds a leftover of exactly half into the unit before it', () => {
    const live = Array.from({ length: 30 }, (_, i) => c(`w${i + 1}`, 'A1', 'x', i + 1))
    expect(assignUnits([], live, new Set(), 20).map((u) => u.entry_ids.length)).toEqual([30])
  })

  it('at the real unit size (20), keeps a leftover over half on its own', () => {
    const live = Array.from({ length: 31 }, (_, i) => c(`w${i + 1}`, 'A1', 'x', i + 1))
    expect(assignUnits([], live, new Set(), 20).map((u) => u.entry_ids.length)).toEqual([20, 11])
  })

  it('moves an entry whose level changed out of its unit, but keeps a retired published entry in place', () => {
    const units = [{ unit_id: 'a1-01', level: 'A1' as const, entry_ids: ['moved', 'retired', 'kept', 'never'] }]
    const out = assignUnits(units, [c('moved', 'A2', 'x', 1), c('kept', 'A1', 'x', 2)], new Set(['moved', 'retired', 'kept']), 20)
    expect(out).toEqual([
      { unit_id: 'a1-01', level: 'A1', entry_ids: ['retired', 'kept'] },
      { unit_id: 'a2-01', level: 'A2', entry_ids: ['moved'], group: 'mixed' },
    ])
  })

  it('never reuses a unit number, even of a unit that is now empty', () => {
    const units = [{ unit_id: 'a1-07', level: 'A1' as const, entry_ids: ['gone'] }]
    const out = assignUnits(units, [c('n', 'A1', 'x', 1)], new Set(), 20)
    expect(out).toEqual([
      { unit_id: 'a1-07', level: 'A1', entry_ids: [] },
      { unit_id: 'a1-08', level: 'A1', entry_ids: ['n'], group: 'mixed' },
    ])
  })
})

describe('assignUnits: a new word joins a unit of its theme (issue 124)', () => {
  const unit = (unit_id: string, entry_ids: string[], extra: { group?: string; level?: 'A1' | 'A2' } = {}) => ({ unit_id, level: extra.level ?? ('A1' as const), entry_ids, ...(extra.group ? { group: extra.group } : {}) })
  const members = (prefix: string, n: number, theme: string, from: number) => Array.from({ length: n }, (_, i) => c(`${prefix}${i + 1}`, 'A1', theme, from + i))
  const ids = (cs: UnitCandidate[]) => cs.map((x) => x.entry_id)

  it('puts a lone new word in the existing unit of its level and theme, not in a unit of its own', () => {
    const time = members('t', 4, 'time', 10)
    const out = assignUnits([unit('a1-01', ids(time))], [...time, c('march', 'A1', 'time', 50)], new Set(), 4)
    expect(out).toEqual([{ unit_id: 'a1-01', level: 'A1', entry_ids: ['t1', 't2', 't3', 't4', 'march'] }])
  })

  it('chooses, among the units of the theme, the one whose words are closest in frequency; the later one on a tie', () => {
    const early = members('e', 4, 'time', 10)
    const late = members('l', 4, 'time', 100)
    const units = [unit('a1-01', ids(early)), unit('a1-02', ids(late))]
    const place = (rank: number) => assignUnits(units, [...early, ...late, c('new', 'A1', 'time', rank)], new Set(), 4).find((u) => u.entry_ids.includes('new'))!.unit_id
    expect(place(90)).toBe('a1-02')
    expect(place(20)).toBe('a1-01')
    // medians 11.5 and 101.5: rank 56.5 is as far from both
    expect(place(56.5)).toBe('a1-02')
  })

  it('fills a unit only to one and a half times the unit size; the rest go to the groups as before', () => {
    const time = Array.from({ length: 25 }, (_, i) => c(`t${i + 1}`, 'A1', 'time', 10 + i))
    const fresh = Array.from({ length: 9 }, (_, i) => c(`n${i + 1}`, 'A1', 'time', 100 + i))
    const out = assignUnits([unit('a1-01', ids(time))], [...time, ...fresh], new Set(), 20)
    expect(out[0]!.entry_ids.slice(25)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5'])
    expect(out.slice(1)).toEqual([{ unit_id: 'a1-02', level: 'A1', entry_ids: ['n6', 'n7', 'n8', 'n9'], group: 'mixed' }])
  })

  it('gives a theme with half a unit of new words its own unit, and leaves the existing one alone', () => {
    const time = members('t', 4, 'time', 10)
    const fresh = members('n', 2, 'time', 20)
    const out = assignUnits([unit('a1-01', ids(time))], [...time, ...fresh], new Set(), 4)
    expect(out).toEqual([
      { unit_id: 'a1-01', level: 'A1', entry_ids: ['t1', 't2', 't3', 't4'] },
      { unit_id: 'a1-02', level: 'A1', entry_ids: ['n1', 'n2'] },
    ])
  })

  it('takes a unit’s theme from most of its live words', () => {
    const mostlyFood = [...members('f', 3, 'food', 10), c('h1', 'A1', 'home', 13)]
    const units = [unit('a1-01', ids(mostlyFood))]
    expect(assignUnits(units, [...mostlyFood, c('new', 'A1', 'food', 14)], new Set(), 4)[0]!.entry_ids).toContain('new')
    expect(assignUnits(units, [...mostlyFood, c('new', 'A1', 'home', 14)], new Set(), 4)[0]!.entry_ids).not.toContain('new')
  })

  it('does not add to a unit of another level, a part-of-speech or mixed unit, or a unit with no live words', () => {
    const food = members('f', 4, 'food', 10)
    const a2 = [c('g1', 'A2', 'food', 30)]
    const units = [
      unit('a1-01', ids(food), { group: 'pos:noun' }),
      unit('a1-02', ['gone1', 'gone2']),
      unit('a2-01', ids(a2), { level: 'A2' }),
    ]
    const out = assignUnits(units, [...food, ...a2, c('new', 'A1', 'food', 14)], new Set(['gone1', 'gone2']), 4)
    expect(out.find((u) => u.entry_ids.includes('new'))).toEqual({ unit_id: 'a1-03', level: 'A1', entry_ids: ['new'], group: 'mixed' })
  })

  it('leaves a new word without a theme to the groups', () => {
    const food = members('f', 4, 'food', 10)
    const out = assignUnits([unit('a1-01', ids(food))], [...food, c('new', 'A1', '', 14)], new Set(), 4)
    expect(out[1]).toEqual({ unit_id: 'a1-02', level: 'A1', entry_ids: ['new'], group: 'mixed' })
  })
})

describe('assignUnits groups (words that share no theme)', () => {
  it('uses a theme only when it has half a unit of new words; the rest group by part of speech', () => {
    const live = [
      ...[1, 2, 3].map((r) => c(`f${r}`, 'A2', 'food', r)),
      c('w1', 'A2', 'weather', 4),
      ...[5, 6, 7].map((r) => c(`v${r}`, 'A2', '', r, 'verb')),
    ]
    // unitSize 6: half is 3. food has 3; weather has 1, so its noun joins the part-of-speech groups.
    const out = assignUnits([], live, new Set(), 6)
    // Groups come in order of their most frequent word: food (1), the lone weather noun (4), the verbs (5).
    expect(out.map((u) => [u.entry_ids, u.group])).toEqual([
      [['f1', 'f2', 'f3'], undefined],
      [['w1'], 'mixed'],
      [['v5', 'v6', 'v7'], 'pos:verb'],
    ])
  })

  it('cuts each group on its own, so no unit mixes two groups', () => {
    const live = [
      ...Array.from({ length: 5 }, (_, i) => c(`n${i}`, 'A1', '', i + 1, 'noun')),
      ...Array.from({ length: 5 }, (_, i) => c(`v${i}`, 'A1', '', i + 10, 'verb')),
    ]
    const out = assignUnits([], live, new Set(), 4)
    expect(out.map((u) => [u.group, u.entry_ids.length])).toEqual([['pos:noun', 5], ['pos:verb', 5]])
  })
})

describe('groupTitles', () => {
  it('numbers part-of-speech and mixed units within their level and group, in English and each L1', () => {
    const units = [
      { unit_id: 'b1-01', level: 'B1' as const, entry_ids: ['a'], group: 'pos:verb' },
      { unit_id: 'b1-02', level: 'B1' as const, entry_ids: ['b'] },
      { unit_id: 'b1-03', level: 'B1' as const, entry_ids: ['c'], group: 'pos:verb' },
      { unit_id: 'b1-04', level: 'B1' as const, entry_ids: ['d'], group: 'mixed' },
      { unit_id: 'a2-05', level: 'A2' as const, entry_ids: ['e'], group: 'pos:verb' },
    ]
    const t = groupTitles(units, ['bg'])
    expect(Object.fromEntries(t)).toEqual({
      'a2-05': { bg: { en: 'Verbs 1', l1: 'Глаголи 1' } },
      'b1-01': { bg: { en: 'Verbs 1', l1: 'Глаголи 1' } },
      'b1-03': { bg: { en: 'Verbs 2', l1: 'Глаголи 2' } },
      'b1-04': { bg: { en: 'More words 1', l1: 'Още думи 1' } },
    })
  })

  it('refuses an L1 without group names', () => {
    expect(() => groupTitles([], ['xx'])).toThrow(/no unit group names for xx/)
  })

  it('names part-of-speech and mixed units in German', () => {
    const units = [
      { unit_id: 'a1-05', level: 'A1' as const, entry_ids: ['x-1'], group: 'pos:verb' },
      { unit_id: 'a1-06', level: 'A1' as const, entry_ids: ['y-1'], group: 'mixed' },
    ]
    const titles = groupTitles(units, ['bg', 'de'])
    expect(titles.get('a1-05')).toEqual({ bg: { en: 'Verbs 1', l1: 'Глаголи 1' }, de: { en: 'Verbs 1', l1: 'Verben 1' } })
    expect(titles.get('a1-06')!['de']).toEqual({ en: 'More words 1', l1: 'Weitere Wörter 1' })
  })

  it('names part-of-speech and mixed units in Spanish', () => {
    const units = [
      { unit_id: 'a1-05', level: 'A1' as const, entry_ids: ['x-1'], group: 'pos:verb' },
      { unit_id: 'a1-06', level: 'A1' as const, entry_ids: ['y-1'], group: 'mixed' },
    ]
    const titles = groupTitles(units, ['bg', 'es'])
    expect(titles.get('a1-05')).toEqual({ bg: { en: 'Verbs 1', l1: 'Глаголи 1' }, es: { en: 'Verbs 1', l1: 'Verbos 1' } })
    expect(titles.get('a1-06')!['es']).toEqual({ en: 'More words 1', l1: 'Más palabras 1' })
  })
})

describe('inPathOrder', () => {
  it('orders by level, then unit number', () => {
    const u = (unit_id: string, level: 'A1' | 'A2') => ({ unit_id, level, entry_ids: ['x'] })
    expect(inPathOrder([u('a2-01', 'A2'), u('a1-10', 'A1'), u('a1-02', 'A1')]).map((x) => x.unit_id)).toEqual(['a1-02', 'a1-10', 'a2-01'])
  })
})
