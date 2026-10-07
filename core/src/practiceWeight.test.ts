import { describe, expect, it } from 'vitest'
import { PRACTICE_WEIGHT_MAX, practiceWeight, weightedOrder } from './practiceWeight'
import { seededRng } from './rng'
import type { ReviewState } from './scheduler'
import { Grade } from './types'

function state(over: Partial<ReviewState> = {}): ReviewState {
  return {
    wordId: 'c:word-1',
    stability: 60,
    difficulty: 5,
    introducedTs: 0,
    introducedDay: 0,
    lastReviewTs: 0,
    lastReviewDay: 0,
    lastGrade: Grade.Good,
    reps: 6,
    lapses: 0,
    passedOnLaterDay: true,
    ...over,
  }
}

describe('practiceWeight', () => {
  it('is 1 for a mature word that was never forgotten and was last rated good or easy', () => {
    expect(practiceWeight(state())).toBe(1)
    expect(practiceWeight(state({ lastGrade: Grade.Easy, stability: 400 }))).toBe(1)
  })

  it('grows as the memory is shorter-lived: mature, then young, then learning', () => {
    const [mature, young, learning] = [60, 10, 1].map((stability) => practiceWeight(state({ stability })))
    expect(young).toBeGreaterThan(mature!)
    expect(learning).toBeGreaterThan(young!)
  })

  it('grows with each time the word was forgotten, up to a limit', () => {
    const byLapses = [0, 1, 2, 3, 9].map((lapses) => practiceWeight(state({ lapses })))
    expect(byLapses[1]).toBeGreaterThan(byLapses[0]!)
    expect(byLapses[2]).toBeGreaterThan(byLapses[1]!)
    expect(byLapses[4]).toBe(byLapses[2])
  })

  it('grows with a last rating of hard, and more with again', () => {
    const [good, hard, again] = [Grade.Good, Grade.Hard, Grade.Again].map((lastGrade) => practiceWeight(state({ lastGrade })))
    expect(hard).toBeGreaterThan(good!)
    expect(again).toBeGreaterThan(hard!)
  })

  it('keeps the spread moderate: the weakest word weighs five times the strongest, never more', () => {
    const weakest = practiceWeight(state({ stability: 0.2, lapses: 7, lastGrade: Grade.Again }))
    expect(weakest).toBe(PRACTICE_WEIGHT_MAX)
    expect(PRACTICE_WEIGHT_MAX).toBe(5)
    // One signal alone stays well under the cap.
    expect(practiceWeight(state({ lastGrade: Grade.Again }))).toBeLessThan(PRACTICE_WEIGHT_MAX)
  })
})

describe('weightedOrder', () => {
  const items = ['weak', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
  const weight = (item: string) => (item === 'weak' ? 5 : 1)

  it('orders every item exactly once', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const order = weightedOrder(items, weight, seededRng(seed))
      expect([...order].sort()).toEqual([...items].sort())
    }
  })

  it('puts a heavy item first clearly more often than a light one, and a light one still sometimes', () => {
    const rng = seededRng(7)
    const first = new Map<string, number>()
    const ROUNDS = 6_000
    for (let i = 0; i < ROUNDS; i += 1) {
      const head = weightedOrder(items, weight, rng)[0]!
      first.set(head, (first.get(head) ?? 0) + 1)
    }
    // Expected: 5/14 for the heavy item, 1/14 for each light one.
    expect(first.get('weak')! / ROUNDS).toBeGreaterThan(0.32)
    expect(first.get('weak')! / ROUNDS).toBeLessThan(0.4)
    for (const light of items.slice(1)) {
      expect(first.get(light)! / ROUNDS).toBeGreaterThan(0.05)
      expect(first.get(light)! / ROUNDS).toBeLessThan(0.09)
    }
  })

  it('differs from one round to the next', () => {
    const rng = seededRng(3)
    const orders = new Set(Array.from({ length: 20 }, () => weightedOrder(items, weight, rng).join()))
    expect(orders.size).toBeGreaterThan(15)
  })

  it('treats a weight that is zero, negative or not a number as the smallest weight rather than dropping the item', () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const rng = seededRng(1)
      let first = 0
      for (let i = 0; i < 200; i += 1) {
        const order = weightedOrder(['x', 'y'], (item) => (item === 'x' ? bad : 1), rng)
        expect([...order].sort()).toEqual(['x', 'y'])
        if (order[0] === 'x') first += 1
      }
      // The item with the bad weight is still ordered, and all but never first.
      expect(first).toBeLessThan(3)
    }
  })
})
