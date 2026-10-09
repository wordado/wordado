import { describe, expect, it } from 'vitest'
import type { RowView } from '../server/types'
import type { DecisionRow } from './db'
import { drawSample, eligible, levelOf, shares, spotCheckResult } from './spotCheck'

const file = 'review/translation-de/a.csv'
const row = (key: string, level: string, over: Partial<RowView> = {}): RowView => ({
  queue: 'translation-de', file, version: 'v', key, kind: 'translation', cells: {}, fields: [], context: { level },
  otherSenses: [], reports: '', ai: 'passed', severity: null, objections: [], decided: null, stale: false, rowHash: `h-${key}`, ...over,
})
const many = (level: string, n: number) => Array.from({ length: n }, (_, i) => row(`${level.toLowerCase()}-${String(i).padStart(3, '0')}`, level))
const objection = { reviewer: 'flash', model: 'm', field: 'translation', category: 'c', severity: 'minor' as const, reason: 'r', fix: 'f' }
const levelsOf = (rows: readonly RowView[], sample: readonly { key: string }[]) => {
  const level = new Map(rows.map((r) => [r.key, levelOf(r)]))
  const out: Record<string, number> = {}
  for (const s of sample) out[level.get(s.key)!] = (out[level.get(s.key)!] ?? 0) + 1
  return out
}

describe('eligible', () => {
  it('takes only a row the AI review passed with no objection, unreported and not stale', () => {
    expect(eligible(row('a', 'A1'))).toBe(true)
    expect(eligible(row('a', 'A1', { ai: 'flagged', severity: 'major', objections: [{ ...objection, severity: 'major' }] }))).toBe(false)
    expect(eligible(row('a', 'A1', { ai: 'unreviewed' }))).toBe(false)
    // passed (under the flagging threshold), but with a minor objection that would steer the reviewer
    expect(eligible(row('a', 'A1', { severity: 'minor', objections: [objection] }))).toBe(false)
    // an objection of a reviewer that is not required leaves the severity empty
    expect(eligible(row('a', 'A1', { objections: [objection] }))).toBe(false)
    expect(eligible(row('a', 'A1', { reports: '1 report (translation): odd word' }))).toBe(false)
    expect(eligible(row('a', 'A1', { stale: true }))).toBe(false)
  })
})

describe('shares', () => {
  it('divides as equally as possible, the remainder to the first groups', () => {
    expect(shares([100, 100, 100], 50)).toEqual([17, 17, 16])
    expect(shares([100, 100, 100, 100, 100], 50)).toEqual([10, 10, 10, 10, 10])
  })

  it('shares out among the others what a group is too small to take', () => {
    expect(shares([3, 100, 100], 50)).toEqual([3, 24, 23])
    expect(shares([100, 2, 5, 100], 50)).toEqual([22, 2, 5, 21])
    expect(shares([4, 40, 40], 50)).toEqual([4, 23, 23])
    // a group that is small only once the first has given way
    expect(shares([1, 9, 100], 30)).toEqual([1, 9, 20])
  })

  it('gives everything when there is less than asked for, and nothing for nothing', () => {
    expect(shares([3, 4], 50)).toEqual([3, 4])
    expect(shares([3, 4], 0)).toEqual([0, 0])
    expect(shares([], 5)).toEqual([])
  })
})

describe('drawSample', () => {
  const rows = [...many('A1', 40), ...many('A2', 40), ...many('B1', 40)]

  it('spreads the sample evenly over the levels', () => {
    const sample = drawSample(rows, 50, 7)
    expect(sample).toHaveLength(50)
    expect(new Set(sample.map((s) => s.key)).size).toBe(50)
    expect(levelsOf(rows, sample)).toEqual({ A1: 17, A2: 17, B1: 16 })
    expect(sample.every((s) => s.file === file)).toBe(true)
  })

  it('gives the other levels what a small level cannot', () => {
    const uneven = [...many('A1', 4), ...many('A2', 40), ...many('B1', 40)]
    expect(levelsOf(uneven, drawSample(uneven, 50, 7))).toEqual({ A1: 4, A2: 23, B1: 23 })
  })

  it('takes every eligible row when there are fewer than asked for', () => {
    const few = [...many('A1', 3), ...many('B1', 2), row('flagged', 'A1', { ai: 'flagged', severity: 'major' })]
    expect(drawSample(few, 50, 7).map((s) => s.key).sort()).toEqual(['a1-000', 'a1-001', 'a1-002', 'b1-000', 'b1-001'])
  })

  it('draws the same sample in the same order for the same seed, whatever order the rows come in', () => {
    const first = drawSample(rows, 20, 1234)
    expect(drawSample(rows, 20, 1234)).toEqual(first)
    expect(drawSample([...rows].reverse(), 20, 1234)).toEqual(first)
    expect(drawSample(rows, 20, 1235)).not.toEqual(first)
  })

  it('mixes the levels in the order shown', () => {
    const sample = drawSample(rows, 30, 7)
    const level = new Map(rows.map((r) => [r.key, levelOf(r)]))
    const shown = sample.map((s) => level.get(s.key))
    expect(shown).not.toEqual(shown.slice().sort())
  })

  it('never draws a row that is not eligible, or one that is taken', () => {
    const mixed = [
      ...many('A1', 5),
      row('flagged', 'A1', { ai: 'flagged', severity: 'major' }),
      row('minor', 'A1', { severity: 'minor', objections: [objection] }),
      row('reported', 'A1', { reports: 'r' }),
      row('stale', 'A1', { stale: true }),
      row('unreviewed', 'A1', { ai: 'unreviewed' }),
    ]
    for (let seed = 0; seed < 25; seed += 1) {
      const keys = drawSample(mixed, 8, seed, (r) => r.key === 'a1-002').map((s) => s.key)
      expect(keys.sort()).toEqual(['a1-000', 'a1-001', 'a1-003', 'a1-004'])
    }
  })
})

describe('spotCheckResult', () => {
  const sample = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((key) => ({ file, key }))
  const decision = (key: string, over: Partial<DecisionRow> = {}): DecisionRow => ({
    assignment: 1, queue: 'translation-de', file, key, rowHash: `h-${key}`, action: 'keep', cells: {}, note: '', severity: null, decidedAt: 't', submission: null, ...over,
  })

  it('counts the rows checked, fine, minor and serious, and names the serious ones in the sample’s order', () => {
    const rows = sample.map((s) => row(s.key, 'A1'))
    const result = spotCheckResult(sample, rows, [
      decision('e', { action: 'drop', severity: 'major' }),
      decision('a'),
      decision('b', { action: 'edit', severity: 'minor' }),
      decision('c', { action: 'edit', severity: 'major', submission: 4 }),
      decision('d', { submission: 4 }),
    ])
    expect(result).toEqual({ checked: 5, fine: 2, minor: 1, serious: 2, seriousKeys: ['c', 'e'] })
  })

  it('is all nought before anything is decided', () => {
    expect(spotCheckResult(sample, sample.map((s) => row(s.key, 'A1')), [])).toEqual({ checked: 0, fine: 0, minor: 0, serious: 0, seriousKeys: [] })
  })

  it('leaves out a decision on a row that changed since, and one outside the sample', () => {
    const rows = [row('a', 'A1'), row('b', 'A1', { rowHash: 'newer' }), row('z', 'A1')]
    expect(spotCheckResult(sample, rows, [decision('a'), decision('b', { action: 'edit', severity: 'major' }), decision('z')])).toMatchObject({ checked: 1, fine: 1, serious: 0 })
  })

  it('counts a submitted decision on a row that has left the snapshot (merged), not an unsubmitted one', () => {
    const result = spotCheckResult(sample, [], [decision('a', { action: 'edit', severity: 'major', submission: 9 }), decision('b', { action: 'edit', severity: 'major' })])
    expect(result).toEqual({ checked: 1, fine: 0, minor: 0, serious: 1, seriousKeys: ['a'] })
  })
})
