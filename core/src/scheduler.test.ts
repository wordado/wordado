import { describe, expect, it } from 'vitest'
import {
  applyGrade,
  DAY_MS,
  dueDay,
  intervalDays,
  isDue,
  localDay,
  RELEARN_DELAY_MS,
  RETENTION_TARGETS,
  retrievability,
  SCHEDULER_VERSION,
  type ReviewState,
} from './scheduler'
import { Grade } from './types'
import { corpusWordId } from './wordId'

const word = corpusWordId('en-000001')
/** Sofia winter time: minutes to ADD to UTC. */
const TZ = 120
/** The instant at which the learner's local wall clock reads day 5+`day` of January 2026, `hour`:`minute`. */
const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 0, 5 + day, hour, minute) - TZ * 60_000
const T0 = at(0, 11)
const { relaxed, standard, intensive } = RETENTION_TARGETS

describe('localDay', () => {
  it('is the learner’s calendar day, so the same instant can fall on different days', () => {
    const ts = Date.UTC(2026, 0, 5, 23, 0)
    expect(localDay(ts, 120)).toBe(localDay(ts, 0) + 1)
    expect(localDay(ts, -300)).toBe(localDay(ts, 0))
  })

  it('advances at the local midnight, not at 24-hour boundaries', () => {
    expect(localDay(at(0, 23, 59), TZ)).toBe(localDay(at(0, 0, 0), TZ))
    expect(localDay(at(1, 0, 0), TZ)).toBe(localDay(at(0, 0, 0), TZ) + 1)
  })
})

describe('applyGrade', () => {
  it('creates state on the first review', () => {
    const s = applyGrade(null, word, Grade.Good, T0, TZ)
    expect(s).toMatchObject({
      wordId: word,
      introducedTs: T0,
      lastReviewTs: T0,
      lastReviewDay: localDay(T0, TZ),
      reps: 1,
      lapses: 0,
    })
    expect(s.stability).toBeGreaterThan(0)
    expect(s.difficulty).toBeGreaterThanOrEqual(1)
    expect(s.difficulty).toBeLessThanOrEqual(10)
  })

  it('gives a first Easy more stability than Good, Good more than Hard, Hard more than Again', () => {
    const by = (g: Grade) => applyGrade(null, word, g, T0, TZ).stability
    expect(by(Grade.Easy)).toBeGreaterThan(by(Grade.Good))
    expect(by(Grade.Good)).toBeGreaterThan(by(Grade.Hard))
    expect(by(Grade.Hard)).toBeGreaterThan(by(Grade.Again))
  })

  it('grows stability on a successful later-day review and keeps introducedTs', () => {
    const first = applyGrade(null, word, Grade.Good, T0, TZ)
    const second = applyGrade(first, word, Grade.Good, T0 + 3 * DAY_MS, TZ)
    expect(second.stability).toBeGreaterThan(first.stability)
    expect(second.introducedTs).toBe(T0)
    expect(second.reps).toBe(2)
  })

  it('counts elapsed time in local days: a next-morning review is one day, not zero', () => {
    const first = applyGrade(null, word, Grade.Good, at(0, 21), TZ)
    const nextMorning = applyGrade(first, word, Grade.Good, at(1, 8), TZ) // 11 hours later
    const fullDay = applyGrade(first, word, Grade.Good, at(0, 21) + DAY_MS, TZ)
    const sameDay = applyGrade(first, word, Grade.Good, at(0, 21), TZ)
    expect(nextMorning.stability).toBeCloseTo(fullDay.stability, 10)
    expect(nextMorning.stability).toBeGreaterThan(sameDay.stability)
  })

  it('counts a lapse only when the word leaves a passed state', () => {
    expect(applyGrade(null, word, Grade.Again, T0, TZ).lapses).toBe(0)
    const first = applyGrade(null, word, Grade.Good, T0, TZ)
    const lapsed = applyGrade(first, word, Grade.Again, T0 + 5 * DAY_MS, TZ)
    expect(lapsed.lapses).toBe(1)
    expect(lapsed.stability).toBeLessThan(first.stability)
  })

  it('counts consecutive Agains once, but Again → Good → Again twice', () => {
    const first = applyGrade(null, word, Grade.Good, T0, TZ)
    const again = applyGrade(first, word, Grade.Again, T0 + 5 * DAY_MS, TZ)
    const againAgain = applyGrade(again, word, Grade.Again, T0 + 5 * DAY_MS, TZ)
    expect(againAgain.lapses).toBe(1)
    const recovered = applyGrade(againAgain, word, Grade.Good, T0 + 5 * DAY_MS, TZ)
    expect(applyGrade(recovered, word, Grade.Again, T0 + 9 * DAY_MS, TZ).lapses).toBe(2)
  })

  it('treats a timestamp before the previous review as zero elapsed time', () => {
    const first = applyGrade(null, word, Grade.Good, T0, TZ)
    expect(() => applyGrade(first, word, Grade.Good, T0 - DAY_MS, TZ)).not.toThrow()
  })

  it('is deterministic', () => {
    const run = () =>
      applyGrade(applyGrade(null, word, Grade.Good, T0, TZ), word, Grade.Hard, T0 + 2 * DAY_MS, TZ)
    expect(run()).toEqual(run())
  })
})

describe('dueDay, isDue and desired retention', () => {
  const state = applyGrade(applyGrade(null, word, Grade.Good, T0, TZ), word, Grade.Good, T0 + 3 * DAY_MS, TZ)

  it('schedules standard retention at about the stability, in whole days', () => {
    expect(intervalDays(10, standard)).toBe(10)
    expect(dueDay(state, standard)).toBe(state.lastReviewDay + intervalDays(state.stability, standard))
  })

  it('orders the three settings: intensive soonest, relaxed latest', () => {
    expect(dueDay(state, intensive)).toBeLessThan(dueDay(state, standard))
    expect(dueDay(state, standard)).toBeLessThan(dueDay(state, relaxed))
  })

  it('never schedules a passed word less than a day out', () => {
    expect(intervalDays(0.2, intensive)).toBe(1)
  })

  it('serves a one-day word on the next local day, however early on it the learner studies', () => {
    const evening = at(0, 20, 30)
    const day = localDay(evening, TZ)
    const state1: ReviewState = { ...applyGrade(null, word, Grade.Good, evening, TZ), stability: 1 }
    expect(intervalDays(state1.stability, standard)).toBe(1)
    expect(isDue(state1, standard, evening, day)).toBe(false)
    expect(isDue(state1, standard, at(0, 23, 59), day)).toBe(false)
    // 30 minutes "early" by the clock, but a new calendar day.
    expect(isDue(state1, standard, at(1, 8), day + 1)).toBe(true)
    expect(isDue(state1, standard, at(1, 20), day + 1)).toBe(true)
  })

  it('brings an Again back the same day, after the relearn delay', () => {
    const ts = T0 + 20 * DAY_MS
    const day = localDay(ts, TZ)
    const lapsed = applyGrade(state, word, Grade.Again, ts, TZ)
    expect(isDue(lapsed, standard, ts + RELEARN_DELAY_MS - 1, day)).toBe(false)
    expect(isDue(lapsed, standard, ts + RELEARN_DELAY_MS, day)).toBe(true)
  })
})

describe('retrievability', () => {
  it('is 1 at the moment of review, ~0.9 at the stability, and falls over time', () => {
    const s = applyGrade(null, word, Grade.Good, T0, TZ)
    expect(retrievability(s, T0)).toBeCloseTo(1, 6)
    expect(retrievability(s, T0 + s.stability * DAY_MS)).toBeCloseTo(0.9, 2)
    expect(retrievability(s, T0 + 30 * DAY_MS)).toBeLessThan(retrievability(s, T0 + 10 * DAY_MS))
  })
})

describe('SCHEDULER_VERSION', () => {
  /**
   * Every branch of the rules on one path: a first review, a later-day success,
   * a lapse, a same-day relearn, a same-day recovery and a later-day success.
   * These numbers are facts about ts-fsrs 5.4.2 with our parameters. If this
   * test fails, the rules changed: bump SCHEDULER_VERSION (and re-derive), do
   * NOT edit the numbers to match.
   */
  it('pins the state the current rules derive; a failure means bump SCHEDULER_VERSION', () => {
    expect(SCHEDULER_VERSION).toBe('fsrs6-tsfsrs5.4.2-r2')

    // Each step's offset is from the step before it, in local days.
    const s1 = applyGrade(null, word, Grade.Good, at(0, 10), TZ) // first review
    expect(s1.stability).toBeCloseTo(2.3065, 6)
    expect(s1.difficulty).toBeCloseTo(2.11810397, 6)

    const s2 = applyGrade(s1, word, Grade.Good, at(2, 10), TZ) // +2 days
    expect(s2.stability).toBeCloseTo(10.96433194, 6)
    expect(s2.difficulty).toBeCloseTo(2.11121424, 6)

    const s3 = applyGrade(s2, word, Grade.Again, at(7, 10), TZ) // +5 days: a lapse
    expect(s3.stability).toBeCloseTo(1.42875311, 6)
    expect(s3.difficulty).toBeCloseTo(7.39223814, 6)

    const s4 = applyGrade(s3, word, Grade.Again, at(7, 10), TZ) // same day: short-term
    expect(s4.stability).toBeCloseTo(0.49549428, 6)
    expect(s4.difficulty).toBeCloseTo(9.12807478, 6)

    const s5 = applyGrade(s4, word, Grade.Good, at(7, 10), TZ) // same day: relearned
    expect(s5.stability).toBeCloseTo(0.54524571, 6)
    expect(s5.difficulty).toBeCloseTo(9.11417507, 6)

    const s6 = applyGrade(s5, word, Grade.Good, at(10, 10), TZ) // +3 days
    expect(s6.stability).toBeCloseTo(2.16541104, 6)
    expect(s6.difficulty).toBeCloseTo(9.10028926, 6)

    expect(s6.reps).toBe(6)
    expect(s6.lapses).toBe(1)

    expect(intervalDays(10, relaxed)).toBe(19)
    expect(intervalDays(10, standard)).toBe(10)
    expect(intervalDays(10, intensive)).toBe(5)
  })
})
