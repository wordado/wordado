import { describe, expect, it } from 'vitest'
import { applyGrade, localDay, RELEARN_DELAY_MS, RETENTION_TARGETS, type ReviewState } from './scheduler'
import { composeSession, learnQueue, MAX_NEW_WORD_LIMIT, type SessionInput } from './session'
import { Grade, type WordFlag } from './types'
import { corpusWordId, type WordId } from './wordId'

const w = (n: number) => corpusWordId(`en-${String(n).padStart(6, '0')}`)
/** Sofia winter time: minutes to ADD to UTC. */
const TZ = 120
/** The instant at which the learner's local wall clock reads `hour`:`minute` on day `day` of the run. */
const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 0, 5 + day, hour, minute) - TZ * 60_000
const TODAY_INDEX = 30
/** This morning, 09:00 local. */
const NOW = at(TODAY_INDEX, 9)
const TODAY = localDay(NOW, TZ)

/** A word first seen on the evening `daysAgo` local days back and rated Good once. */
function seen(n: number, daysAgo: number): [WordId, ReviewState] {
  return [w(n), applyGrade(null, w(n), Grade.Good, at(TODAY_INDEX - daysAgo, 20), TZ)]
}

function input(over: Partial<SessionInput> = {}): SessionInput {
  return {
    now: NOW,
    today: TODAY,
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

  it('is one call for the home screen and the session: a word due today is due all day', () => {
    // Studied yesterday evening, one day of interval: due from the first minute of today.
    const yesterday = applyGrade(null, w(1), Grade.Good, at(TODAY_INDEX - 1, 20, 30), TZ)
    const states = new Map([[w(1), { ...yesterday, stability: 1 }]])
    expect(composeSession(input({ states })).reviews).toEqual([w(1)])
    expect(composeSession(input({ states, now: at(TODAY_INDEX, 0, 5) })).reviews).toEqual([w(1)])
    expect(composeSession(input({ states, now: at(TODAY_INDEX, 23, 55) })).reviews).toEqual([w(1)])
    // And not yet on the day it was studied.
    const lastNight = input({ states, now: at(TODAY_INDEX - 1, 23, 0), today: TODAY - 1 })
    expect(composeSession(lastNight).reviews).toEqual([])
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

  it('lets a word rated Again today come back even with the cap exhausted', () => {
    const ts = NOW - 11 * 60 * 1000
    const lapsed = applyGrade(applyGrade(null, w(1), Grade.Good, at(TODAY_INDEX - 9, 20), TZ), w(1), Grade.Again, ts, TZ)
    const plan = composeSession(
      input({ states: new Map([[w(1), lapsed]]), reviewCap: 5, reviewsDoneToday: 5, pathNew: [w(100)] }),
    )
    expect(plan.reviews).toEqual([w(1)])
    expect(plan.backlogTotal).toBe(0)
    expect(plan.newWordsPaused).toBe(false)
  })

  it('serves the capped scheduled words first, then today’s relearns', () => {
    const backlogStates = new Map(Array.from({ length: 3 }, (_, i) => seen(i + 1, 10)))
    const ts = NOW - 11 * 60 * 1000
    const lapsed = applyGrade(applyGrade(null, w(9), Grade.Good, at(TODAY_INDEX - 9, 20), TZ), w(9), Grade.Again, ts, TZ)
    const states = new Map([...backlogStates, [w(9), lapsed]])
    const plan = composeSession(input({ states, reviewCap: 2 }))
    expect(plan.reviews).toHaveLength(3)
    expect(plan.reviews.at(-1)).toBe(w(9))
    expect(plan.backlogTotal).toBe(3)
    expect(plan.newWordsPaused).toBe(true)
  })

  it('does not serve a word rated Again before the relearn delay has passed', () => {
    const ts = NOW - 60 * 1000
    const lapsed = applyGrade(applyGrade(null, w(1), Grade.Good, at(TODAY_INDEX - 9, 20), TZ), w(1), Grade.Again, ts, TZ)
    expect(composeSession(input({ states: new Map([[w(1), lapsed]]) })).reviews).toEqual([])
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

  it('falls back to the path when every word left in the collection is introduced or flagged', () => {
    const plan = composeSession(
      input({
        states: new Map([seen(70, 3)]),
        flags: new Map<WordId, WordFlag>([[w(71), 'known'], [w(72), 'suspended']]),
        collectionNew: [w(70), w(71), w(72)],
        pathNew: [w(1), w(2)],
      }),
    )
    expect(plan.newWords).toEqual([w(1), w(2)])
  })

  it('still gives the collection the whole quota while one servable word is left in it', () => {
    const plan = composeSession(
      input({
        states: new Map([seen(70, 3)]),
        collectionNew: [w(70), w(71)],
        pathNew: [w(1), w(2)],
      }),
    )
    expect(plan.newWords).toEqual([w(71)])
  })

  it('only reviews when the limit is 0', () => {
    const plan = composeSession(input({ newWordLimit: 0, states: new Map([seen(1, 5)]), pathNew: [w(2)] }))
    expect(plan.reviews).toEqual([w(1)])
    expect(plan.newWords).toEqual([])
  })

  it('clamps the daily limit to the configurable range', () => {
    const pathNew = Array.from({ length: 50 }, (_, i) => w(i + 1))
    expect(composeSession(input({ newWordLimit: 999, pathNew })).newWords).toHaveLength(MAX_NEW_WORD_LIMIT)
    expect(composeSession(input({ newWordLimit: -5, pathNew })).newWords).toEqual([])
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

describe('words the learner chose to learn (spec §7.4)', () => {
  const marks = new Map<WordId, number>([
    [w(7), 300],
    [w(5), 100],
    [w(9), 200],
    [w(6), 200],
  ])

  it('queues them in the order chosen, with a stable order for two chosen at the same instant', () => {
    expect(learnQueue(marks, new Map())).toEqual([w(5), w(6), w(9), w(7)])
  })

  it('ignores a mark once its word is started: the mark is spent', () => {
    expect(learnQueue(marks, new Map([seen(5, 0), seen(9, 3)]))).toEqual([w(6), w(7)])
    expect(learnQueue(new Map(), new Map([seen(5, 0)]))).toEqual([])
  })

  it('serves them first, before an active collection and the path, within what is left of the daily limit', () => {
    const personalNew = learnQueue(marks, new Map())
    const pathNew = [w(1), w(2), w(3)]
    expect(composeSession(input({ newWordLimit: 6, personalNew, pathNew })).newWords).toEqual([w(5), w(6), w(9), w(7), w(1), w(2)])
    expect(composeSession(input({ newWordLimit: 6, personalNew, collectionNew: [w(20), w(21), w(22)], pathNew })).newWords).toEqual([w(5), w(6), w(9), w(7), w(20), w(21)])
    // The limit holds for them too: three today, the fourth tomorrow.
    expect(composeSession(input({ newWordLimit: 5, newWordsDoneToday: 2, personalNew, pathNew })).newWords).toEqual([w(5), w(6), w(9)])
    expect(composeSession(input({ newWordLimit: 5, newWordsDoneToday: 5, personalNew, pathNew })).newWords).toEqual([])
  })

  it('serves a chosen word once when the path would serve it too (its level is no longer skipped)', () => {
    const plan = composeSession(input({ newWordLimit: 3, personalNew: learnQueue(new Map([[w(2), 5]]), new Map()), pathNew: [w(1), w(2), w(3)] }))
    expect(plan.newWords).toEqual([w(2), w(1), w(3)])
  })

  it('serves a chosen word once when the collection would serve it too (marked in a theme’s practice, then the theme is studied)', () => {
    const personalNew = learnQueue(new Map([[w(21), 5]]), new Map())
    const plan = composeSession(input({ newWordLimit: 4, personalNew, collectionNew: [w(20), w(21), w(22), w(23)], pathNew: [w(1)] }))
    expect(plan.newWords).toEqual([w(21), w(20), w(22), w(23)])
    // The slot it would have taken twice goes to the next word of the theme, not to nothing.
    expect(new Set(plan.newWords).size).toBe(4)
  })

  it('does not serve a chosen word that is set aside or already started, and waits with the rest while new words are paused', () => {
    const personalNew = [...marks.keys()]
    const flags = new Map<WordId, WordFlag>([[w(7), 'suspended']])
    const plan = composeSession(input({ states: new Map([seen(5, 0)]), flags, personalNew, pathNew: [w(1)] }))
    expect(plan.newWords).toEqual([w(9), w(6), w(1)])
    const backlog = new Map(Array.from({ length: 3 }, (_, i) => seen(30 + i, 20)))
    expect(composeSession(input({ states: backlog, reviewCap: 2, personalNew, pathNew: [w(1)] }))).toMatchObject({ newWords: [], newWordsPaused: true })
  })
})

describe('composeSession: relearning across devices', () => {
  it('treats a word last reviewed on a later local day as relearning, not as backlog', () => {
    // Rated Again at 12:30 Sofia time on a device set to UTC+14, where it is already 00:30 tomorrow.
    const ahead = applyGrade(null, w(1), Grade.Again, at(TODAY_INDEX, 12, 30), 14 * 60)
    expect(ahead.lastReviewDay).toBe(TODAY + 1)
    const now = at(TODAY_INDEX, 12, 30) + RELEARN_DELAY_MS
    const plan = composeSession(input({ states: new Map([[w(1), ahead]]), now }))
    expect(plan.reviews).toEqual([w(1)])
    expect(plan.backlogTotal).toBe(0)
    expect(plan.newWordsPaused).toBe(false)
  })
})
