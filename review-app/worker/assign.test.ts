import { describe, expect, it } from 'vitest'
import { clashes, filesOverlap, proposeSplit, SplitError, type Coverage } from './assign'

describe('filesOverlap', () => {
  it('treats * as every file', () => {
    expect(filesOverlap('*', ['a'])).toBe(true)
    expect(filesOverlap(['a'], '*')).toBe(true)
    expect(filesOverlap(['a', 'b'], ['c'])).toBe(false)
    expect(filesOverlap(['a', 'b'], ['b'])).toBe(true)
  })
})

describe('clashes', () => {
  const all = (files: Coverage['files']): Coverage => ({ files, flaggedOnly: false, spotCheck: false })
  const flagged = (files: Coverage['files']): Coverage => ({ files, flaggedOnly: true, spotCheck: false })
  const spot = (files: Coverage['files']): Coverage => ({ files, flaggedOnly: false, spotCheck: true })

  it('keeps the rule for assignments of files: they clash when they share a file, flagged-only or not', () => {
    expect(clashes(all(['a']), flagged('*'))).toBe(true)
    expect(clashes(flagged(['a']), flagged(['a', 'b']))).toBe(true)
    expect(clashes(all(['a']), all(['b']))).toBe(false)
  })

  it('lets a spot check stand beside a flagged-only assignment of its files', () => {
    expect(clashes(spot(['a']), flagged('*'))).toBe(false)
    expect(clashes(flagged(['a']), spot('*'))).toBe(false)
  })

  it('refuses a spot check beside an all-rows assignment that shares a file, either way round', () => {
    expect(clashes(spot('*'), all(['a']))).toBe(true)
    expect(clashes(all(['a', 'b']), spot(['b']))).toBe(true)
    expect(clashes(all(['a']), spot(['b']))).toBe(false)
  })

  it('refuses a second spot check of the queue, whatever its files', () => {
    expect(clashes(spot(['a']), spot(['b']))).toBe(true)
  })
})

describe('proposeSplit', () => {
  it('deals whole files so each reviewer gets about the same weight', () => {
    const files = [10, 9, 8, 7, 6, 5].map((w, i) => ({ file: `f${i}`, weight: w * 10 }))
    const p = proposeSplit(files, ['a@example.com', 'b@example.com'])
    expect(p.map((x) => x.rows).sort()).toEqual([220, 230])
    expect(p.flatMap((x) => x.files).sort()).toEqual(['f0', 'f1', 'f2', 'f3', 'f4', 'f5'])
    expect(p[0]!.files).toEqual([...p[0]!.files].sort())
  })

  it('refuses fewer files than reviewers, or fewer than two reviewers', () => {
    expect(() => proposeSplit([{ file: 'f', weight: 1 }], ['a', 'b'])).toThrow(SplitError)
    expect(() => proposeSplit([{ file: 'f', weight: 1 }, { file: 'g', weight: 1 }], ['a'])).toThrow(/two or more/)
  })

  it('refuses with a message naming the shortfall', () => {
    expect(() => proposeSplit([{ file: 'f', weight: 1 }], ['a@example.com', 'b@example.com'])).toThrow(/only 1 free files for 2 reviewers/)
  })

  it('allows exactly as many files as reviewers, one each', () => {
    const files = [{ file: 'f0', weight: 5 }, { file: 'f1', weight: 3 }, { file: 'f2', weight: 1 }]
    const p = proposeSplit(files, ['a@example.com', 'b@example.com', 'c@example.com'])
    expect(p).toHaveLength(3)
    expect(p.flatMap((x) => x.files).sort()).toEqual(['f0', 'f1', 'f2'])
    expect(p.every((x) => x.files.length === 1)).toBe(true)
  })

  it('splits evenly among three reviewers when weights are equal, breaking ties by filename', () => {
    const files = ['f3', 'f1', 'f0', 'f2', 'f4', 'f5'].map((file) => ({ file, weight: 10 }))
    const p = proposeSplit(files, ['a@example.com', 'b@example.com', 'c@example.com'])
    expect(p.map((x) => x.rows)).toEqual([20, 20, 20])
    // Heaviest-first with equal weights ties by filename, so file order is deterministic: f0, f1, f2, f3, f4, f5
    // dealt round-robin to the three least-loaded reviewers in order.
    expect(p[0]!.files).toEqual(['f0', 'f3'])
    expect(p[1]!.files).toEqual(['f1', 'f4'])
    expect(p[2]!.files).toEqual(['f2', 'f5'])
  })

  it('keeps each reviewer’s own files sorted', () => {
    const files = ['zz', 'aa', 'mm', 'bb'].map((file, i) => ({ file, weight: i + 1 }))
    const p = proposeSplit(files, ['a@example.com', 'b@example.com'])
    for (const part of p) expect(part.files).toEqual([...part.files].sort())
  })
})
