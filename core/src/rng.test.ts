import { describe, expect, it } from 'vitest'
import { seededRng, shuffle } from './rng'

describe('seededRng', () => {
  it('repeats for the same seed and differs across seeds', () => {
    const take = (seed: number) => Array.from({ length: 5 }, seededRng(seed))
    expect(take(42)).toEqual(take(42))
    expect(take(42)).not.toEqual(take(43))
  })

  it('stays inside [0, 1)', () => {
    const rng = seededRng(7)
    for (let i = 0; i < 10_000; i += 1) {
      const x = rng()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('shuffle', () => {
  it('permutes without mutating its input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8]
    const out = shuffle(input, seededRng(1))
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([...out].sort((a, b) => a - b)).toEqual(input)
    expect(out).not.toEqual(input)
  })
})
