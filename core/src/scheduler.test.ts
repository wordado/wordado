import { describe, expect, it } from 'vitest'
import {
  applyGrade,
  DAY_MS,
  dueAt,
  intervalDays,
  RELEARN_DELAY_MS,
  RETENTION_TARGETS,
  retrievability,
  SCHEDULER_VERSION,
} from './scheduler'
import { Grade } from './types'
import { corpusWordId } from './wordId'

const word = corpusWordId('en-000001')
const T0 = Date.UTC(2026, 0, 5, 9, 0, 0)

describe('applyGrade', () => {
  it('creates state on the first review', () => {
    const s = applyGrade(null, word, Grade.Good, T0)
    expect(s).toMatchObject({ wordId: word, introducedTs: T0, lastReviewTs: T0, reps: 1, lapses: 0 })
    expect(s.stability).toBeGreaterThan(0)
    expect(s.difficulty).toBeGreaterThanOrEqual(1)
    expect(s.difficulty).toBeLessThanOrEqual(10)
  })

  it('gives a first Easy more stability than Good, Good more than Hard, Hard more than Again', () => {
    const by = (g: Grade) => applyGrade(null, word, g, T0).stability
    expect(by(Grade.Easy)).toBeGreaterThan(by(Grade.Good))
    expect(by(Grade.Good)).toBeGreaterThan(by(Grade.Hard))
    expect(by(Grade.Hard)).toBeGreaterThan(by(Grade.Again))
  })

  it('grows stability on a successful later-day review and keeps introducedTs', () => {
    const first = applyGrade(null, word, Grade.Good, T0)
    const second = applyGrade(first, word, Grade.Good, T0 + 3 * DAY_MS)
    expect(second.stability).toBeGreaterThan(first.stability)
    expect(second.introducedTs).toBe(T0)
    expect(second.reps).toBe(2)
  })

  it('counts a lapse for Again on a known word, but not on the first exposure', () => {
    expect(applyGrade(null, word, Grade.Again, T0).lapses).toBe(0)
    const first = applyGrade(null, word, Grade.Good, T0)
    const lapsed = applyGrade(first, word, Grade.Again, T0 + 5 * DAY_MS)
    expect(lapsed.lapses).toBe(1)
    expect(lapsed.stability).toBeLessThan(first.stability)
  })

  it('treats a timestamp before the previous review as zero elapsed time', () => {
    const first = applyGrade(null, word, Grade.Good, T0)
    expect(() => applyGrade(first, word, Grade.Good, T0 - DAY_MS)).not.toThrow()
  })

  it('is deterministic', () => {
    const run = () => applyGrade(applyGrade(null, word, Grade.Good, T0), word, Grade.Hard, T0 + 2 * DAY_MS)
    expect(run()).toEqual(run())
  })
})

describe('dueAt and desired retention', () => {
  const state = applyGrade(applyGrade(null, word, Grade.Good, T0), word, Grade.Good, T0 + 3 * DAY_MS)

  it('schedules standard retention at about the stability, in whole days', () => {
    expect(intervalDays(10, RETENTION_TARGETS.standard)).toBe(10)
    expect((dueAt(state, RETENTION_TARGETS.standard) - state.lastReviewTs) % DAY_MS).toBe(0)
  })

  it('orders the three settings: intensive soonest, relaxed latest', () => {
    const due = (r: number) => dueAt(state, r)
    expect(due(RETENTION_TARGETS.intensive)).toBeLessThan(due(RETENTION_TARGETS.standard))
    expect(due(RETENTION_TARGETS.standard)).toBeLessThan(due(RETENTION_TARGETS.relaxed))
  })

  it('never schedules a passed word less than a day out', () => {
    expect(intervalDays(0.2, RETENTION_TARGETS.intensive)).toBe(1)
  })

  it('brings an Again back the same day', () => {
    const lapsed = applyGrade(state, word, Grade.Again, T0 + 20 * DAY_MS)
    expect(dueAt(lapsed, RETENTION_TARGETS.standard)).toBe(lapsed.lastReviewTs + RELEARN_DELAY_MS)
  })
})

describe('retrievability', () => {
  it('is 1 at the moment of review, ~0.9 at the stability, and falls over time', () => {
    const s = applyGrade(null, word, Grade.Good, T0)
    expect(retrievability(s, T0)).toBeCloseTo(1, 6)
    expect(retrievability(s, T0 + s.stability * DAY_MS)).toBeCloseTo(0.9, 2)
    expect(retrievability(s, T0 + 30 * DAY_MS)).toBeLessThan(retrievability(s, T0 + 10 * DAY_MS))
  })
})

describe('SCHEDULER_VERSION', () => {
  it('pins the state the current rules derive; bump the version if this changes', () => {
    const s = applyGrade(applyGrade(null, word, Grade.Good, T0), word, Grade.Good, T0 + 2 * DAY_MS)
    expect(SCHEDULER_VERSION).toBe('fsrs6-tsfsrs5.4.2-r1')
    expect(s.stability).toBeCloseTo(10.96433194, 6)
    expect(s.difficulty).toBeCloseTo(2.11121424, 6)
  })
})
