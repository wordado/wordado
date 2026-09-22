import { describe, expect, it } from 'vitest'
import type { DaySummary } from './activity'
import { TIER_MIN_STABILITY_DAYS } from './mastery'
import { levelCompletion, retentionRate, unitProgress } from './progress'
import { applyGrade, localDay, type ReviewState } from './scheduler'
import { Grade, type CefrLevel, type Unit, type WordFlag } from './types'
import { corpusWordId, type WordId } from './wordId'

const w = (n: number) => corpusWordId(`en-${String(n).padStart(6, '0')}`)
const TZ = 120
const at = (day: number, hour: number) => Date.UTC(2026, 0, 5 + day, hour) - TZ * 60_000
const TODAY = localDay(at(40, 12), TZ)
const unit = (unitId: string, level: CefrLevel, order: number, ids: number[]): Unit => ({ unitId, level, order, wordIds: ids.map(w) })

/** Introduced on day 0 and, if `passed`, rated Good on day 3; `stability` overrides the result. */
function state(n: number, passed: boolean, stability?: number): [WordId, ReviewState] {
  let s = applyGrade(null, w(n), Grade.Good, at(0, 10), TZ)
  if (passed) s = applyGrade(s, w(n), Grade.Good, at(3, 10), TZ)
  return [w(n), stability === undefined ? s : { ...s, stability }]
}

const visible = { retired: new Set<WordId>(), flags: new Map<WordId, WordFlag>() }

describe('retentionRate', () => {
  const summary = (day: number, reviews: number, successes: number): DaySummary => ({ day, reviews, successes, newWords: 0 })

  it('is null until a review has been counted', () => {
    expect(retentionRate([], TODAY)).toBeNull()
    expect(retentionRate([summary(TODAY, 0, 0)], TODAY)).toBeNull()
  })

  it('is first-attempt successes over reviews in the trailing 30 days, today included', () => {
    const days = [summary(TODAY, 4, 3), summary(TODAY - 29, 6, 3), summary(TODAY - 30, 10, 0), summary(TODAY + 1, 10, 0)]
    expect(retentionRate(days, TODAY)).toBeCloseTo(6 / 10, 10)
    expect(retentionRate(days, TODAY, 1)).toBeCloseTo(3 / 4, 10)
  })
})

describe('unitProgress', () => {
  const u = unit('a1-u1', 'A1', 1, [1, 2, 3, 4, 5])

  it('counts live, introduced, passed and mature words', () => {
    const states = new Map([state(1, true), state(2, true, TIER_MIN_STABILITY_DAYS.mature), state(3, false)])
    expect(unitProgress(u, states, visible)).toEqual({ live: 5, introduced: 3, passed: 2, mature: 1, complete: false, mastered: false })
  })

  it('is complete at 80% passed on a later day and mastered at 90% mature', () => {
    const four = new Map([state(1, true), state(2, true), state(3, true), state(4, true), state(5, false)])
    expect(unitProgress(u, four, visible).complete).toBe(true)
    const mature = new Map([1, 2, 3, 4, 5].map((n) => state(n, true, TIER_MIN_STABILITY_DAYS.mature)))
    expect(unitProgress(u, mature, visible)).toMatchObject({ complete: true, mastered: true })
    const fourMature = new Map([...mature].map(([id, s], i) => [id, i === 4 ? { ...s, stability: 1 } : s] as const))
    expect(unitProgress(u, fourMature, visible).mastered).toBe(false)
  })

  it('leaves retired, known and suspended words out, so a known word is never mature', () => {
    const states = new Map([state(1, true, 100), state(2, true, 100), state(3, true, 100), state(4, true, 100)])
    const ctx = { retired: new Set([w(5)]), flags: new Map<WordId, WordFlag>([[w(4), 'known'], [w(3), 'suspended']]) }
    expect(unitProgress(u, states, ctx)).toEqual({ live: 2, introduced: 2, passed: 2, mature: 2, complete: true, mastered: true })
  })

  it('is neither complete nor mastered with no live word', () => {
    const ctx = { retired: new Set(u.wordIds), flags: new Map() }
    expect(unitProgress(u, new Map(), ctx)).toMatchObject({ live: 0, complete: false, mastered: false })
  })
})

describe('levelCompletion', () => {
  const units = [unit('a1-u1', 'A1', 1, [1, 2]), unit('a1-u2', 'A1', 2, [3, 4]), unit('a2-u1', 'A2', 3, [5, 6])]

  it('is the share of the band’s live entries that are mature', () => {
    const states = new Map([state(1, true, 30), state(2, true, 30), state(3, true, 30), state(5, true, 30)])
    expect(levelCompletion('A1', units, states, { ...visible, declaredLevel: 'A1' })).toEqual({ kind: 'progress', live: 4, mature: 3, share: 0.75 })
    expect(levelCompletion('A2', units, states, { ...visible, declaredLevel: 'A1' })).toEqual({ kind: 'progress', live: 2, mature: 1, share: 0.5 })
  })

  it('shows a band below the declared level as skipped, never as 100%', () => {
    const states = new Map([1, 2, 3, 4].map((n) => state(n, true, 30)))
    expect(levelCompletion('A1', units, states, { ...visible, declaredLevel: 'A2' })).toEqual({ kind: 'skipped' })
    expect(levelCompletion('A2', units, states, { ...visible, declaredLevel: 'A2' })).toEqual({ kind: 'progress', live: 2, mature: 0, share: 0 })
  })

  it('is zero, not NaN, for a band with no live entry', () => {
    expect(levelCompletion('B1', units, new Map(), { ...visible, declaredLevel: 'A1' })).toEqual({ kind: 'progress', live: 0, mature: 0, share: 0 })
  })
})
