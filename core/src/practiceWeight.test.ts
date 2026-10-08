import { describe, expect, it } from 'vitest'
import { pickUnseenFirst, PRACTICE_WEIGHT_MAX, practiceWeight, weightedOrder } from './practiceWeight'
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

  it('is the base weight, 1, for a word with no review state (practice of a skipped level’s unit, spec §7.4)', () => {
    expect(practiceWeight(undefined)).toBe(1)
    expect(practiceWeight(null)).toBe(1)
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

describe('pickUnseenFirst: a visit covers the scope before it repeats (spec §7.4)', () => {
  const items = Array.from({ length: 23 }, (_, i) => `w${i}`)
  const even = () => 1

  it('goes through every candidate before any comes twice, round after round', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const rng = seededRng(seed)
      const shown = new Set<string>()
      for (const expected of [10, 20]) {
        const round = pickUnseenFirst(items, shown, 10, even, rng)
        expect(round).toHaveLength(10)
        expect(round.some((item) => shown.has(item))).toBe(false)
        for (const item of round) shown.add(item)
        expect(shown.size).toBe(expected)
      }
      // Three are left: they lead the round, and words already shown fill it up, none twice.
      const last = pickUnseenFirst(items, shown, 10, even, rng)
      expect(last).toHaveLength(10)
      expect(new Set(last).size).toBe(10)
      expect(last.slice(0, 3).every((item) => !shown.has(item))).toBe(true)
      expect(last.slice(3).every((item) => shown.has(item))).toBe(true)
      for (const item of last) shown.add(item)
      expect(shown.size).toBe(items.length)
    }
  })

  it('starts over once all have been shown: the draw is then the plain weighted one', () => {
    const all = new Set(items)
    expect(pickUnseenFirst(items, all, 10, even, seededRng(4))).toEqual(weightedOrder(items, even, seededRng(4)).slice(0, 10))
    expect(pickUnseenFirst(items, new Set(), 10, even, seededRng(4))).toEqual(weightedOrder(items, even, seededRng(4)).slice(0, 10))
  })

  it('leans towards the heavier words among those not yet shown, and among those that fill a round up', () => {
    const weight = (item: string) => (item === 'w0' || item === 'w20' ? 5 : 1)
    const shown = new Set(items.slice(0, 18))
    const rng = seededRng(9)
    let unseenLead = 0
    let fillLead = 0
    const ROUNDS = 3_000
    for (let i = 0; i < ROUNDS; i += 1) {
      const round = pickUnseenFirst(items, shown, 6, weight, rng)
      // Five unseen words (w18 to w22), then one of the eighteen shown.
      expect(round.slice(0, 5).every((item) => !shown.has(item))).toBe(true)
      if (round[0] === 'w20') unseenLead += 1
      if (round[5] === 'w0') fillLead += 1
    }
    // Expected 5/9 against 1/9 for a light unseen word, and 5/22 against 1/22 for a light shown one.
    expect(unseenLead / ROUNDS).toBeGreaterThan(0.5)
    expect(unseenLead / ROUNDS).toBeLessThan(0.62)
    expect(fillLead / ROUNDS).toBeGreaterThan(0.18)
    expect(fillLead / ROUNDS).toBeLessThan(0.28)
  })

  it('gives no more than there are, nothing for a count of zero or less, and ignores shown words that are not candidates', () => {
    expect(pickUnseenFirst(items.slice(0, 4), new Set(), 10, even, seededRng(1))).toHaveLength(4)
    expect(pickUnseenFirst(items.slice(0, 4), new Set(['w1', 'gone']), 10, even, seededRng(1)).slice(3)).toEqual(['w1'])
    expect(pickUnseenFirst(items, new Set(), 0, even, seededRng(1))).toEqual([])
    expect(pickUnseenFirst(items, new Set(), -2, even, seededRng(1))).toEqual([])
    expect(pickUnseenFirst([], new Set(['w1']), 10, even, seededRng(1))).toEqual([])
  })

  it('is the same draw for the same seed, and another for another', () => {
    const shown = new Set(items.slice(0, 7))
    expect(pickUnseenFirst(items, shown, 10, even, seededRng(42))).toEqual(pickUnseenFirst(items, shown, 10, even, seededRng(42)))
    expect(pickUnseenFirst(items, shown, 10, even, seededRng(42))).not.toEqual(pickUnseenFirst(items, shown, 10, even, seededRng(43)))
  })
})
