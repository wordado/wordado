import { describe, expect, it } from 'vitest'
import { applyGrade, DAY_MS, RETENTION_TARGETS, type ReviewState } from './scheduler'
import { composeSession, type SessionInput } from './session'
import { Grade, type WordFlag } from './types'
import { corpusWordId, type WordId } from './wordId'

const w = (n: number) => corpusWordId(`en-${String(n).padStart(6, '0')}`)
const T0 = Date.UTC(2026, 0, 5, 9)
const NOW = T0 + 30 * DAY_MS

/** A word first seen `daysAgo` days before NOW and rated Good once. */
function seen(n: number, daysAgo: number): [WordId, ReviewState] {
  return [w(n), applyGrade(null, w(n), Grade.Good, NOW - daysAgo * DAY_MS)]
}

function input(over: Partial<SessionInput> = {}): SessionInput {
  return {
    now: NOW,
    dueBefore: NOW,
    states: new Map(),
    flags: new Map(),
    retention: RETENTION_TARGETS.standard,
    newWordLimit: 10,
    reviewCap: 100,
    reviewsDoneToday: 0,
    newWordsDoneToday: 0,
    personalNew: [],
    collectionNew: null,
    pathNew: [],
    ...over,
  }
}

describe('composeSession: reviews', () => {
  it('serves only due words, lowest retrievability first', () => {
    const plan = composeSession(input({ states: new Map([seen(1, 5), seen(2, 20), seen(3, 1), seen(4, 10)]) }))
    expect(plan.reviews).toEqual([w(2), w(4), w(1)])
    expect(plan.backlogTotal).toBe(3)
  })

  it('leaves known and suspended words out of review without touching their state', () => {
    const states = new Map([seen(1, 5), seen(2, 5), seen(3, 5)])
    const flags = new Map<WordId, WordFlag>([[w(1), 'known'], [w(2), 'suspended']])
    const plan = composeSession(input({ states, flags }))
    expect(plan.reviews).toEqual([w(3)])
    expect(states.size).toBe(3)
  })

  it('uses dueBefore, so the home screen can count words due later today', () => {
    const states = new Map([seen(1, 1.5)]) // due in half a day
    expect(composeSession(input({ states })).reviews).toEqual([])
    expect(composeSession(input({ states, dueBefore: NOW + DAY_MS })).reviews).toEqual([w(1)])
  })

  it('reschedules immediately when desired retention changes', () => {
    const states = new Map([[w(1), { ...seen(1, 6)[1], stability: 10 }]])
    expect(composeSession(input({ states, retention: RETENTION_TARGETS.standard })).reviews).toEqual([])
    expect(composeSession(input({ states, retention: RETENTION_TARGETS.intensive })).reviews).toEqual([w(1)])
  })
})

describe('composeSession: backlog protection', () => {
  const backlog = new Map(Array.from({ length: 12 }, (_, i) => seen(i + 1, 10)))

  it('caps the day’s reviews, reports the whole backlog, and pauses new words', () => {
    const plan = composeSession(input({ states: backlog, reviewCap: 5, pathNew: [w(100)] }))
    expect(plan.reviews).toHaveLength(5)
    expect(plan.backlogTotal).toBe(12)
    expect(plan.newWordsPaused).toBe(true)
    expect(plan.newWords).toEqual([])
  })

  it('counts reviews already done today against the cap', () => {
    const plan = composeSession(input({ states: backlog, reviewCap: 5, reviewsDoneToday: 3 }))
    expect(plan.reviews).toHaveLength(2)
    expect(composeSession(input({ states: backlog, reviewCap: 5, reviewsDoneToday: 9 })).reviews).toEqual([])
  })

  it('resumes new words once the backlog fits under the cap', () => {
    const plan = composeSession(input({ states: backlog, reviewCap: 12, pathNew: [w(100)] }))
    expect(plan.newWordsPaused).toBe(false)
    expect(plan.newWords).toEqual([w(100)])
  })
})

describe('composeSession: new words', () => {
  it('takes personal words first, then the path, up to what is left of the daily limit', () => {
    const plan = composeSession(
      input({ newWordLimit: 4, newWordsDoneToday: 1, personalNew: [w(50)], pathNew: [w(1), w(2), w(3)] }),
    )
    expect(plan.newWords).toEqual([w(50), w(1), w(2)])
  })

  it('gives an active collection the whole quota, and the path waits', () => {
    const plan = composeSession(input({ newWordLimit: 5, collectionNew: [w(70), w(71)], pathNew: [w(1), w(2), w(3)] }))
    expect(plan.newWords).toEqual([w(70), w(71)])
  })

  it('falls back to the path when the collection is exhausted or cleared', () => {
    expect(composeSession(input({ collectionNew: [], pathNew: [w(1)] })).newWords).toEqual([w(1)])
    expect(composeSession(input({ collectionNew: null, pathNew: [w(1)] })).newWords).toEqual([w(1)])
  })

  it('only reviews when the limit is 0', () => {
    const plan = composeSession(input({ newWordLimit: 0, states: new Map([seen(1, 5)]), pathNew: [w(2)] }))
    expect(plan.reviews).toEqual([w(1)])
    expect(plan.newWords).toEqual([])
  })

  it('never offers a word that is already introduced, flagged, or listed twice', () => {
    const plan = composeSession(
      input({
        states: new Map([seen(1, 0)]),
        flags: new Map<WordId, WordFlag>([[w(2), 'known']]),
        personalNew: [w(3)],
        pathNew: [w(1), w(2), w(3), w(4)],
      }),
    )
    expect(plan.newWords).toEqual([w(3), w(4)])
  })
})
