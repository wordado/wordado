import { describe, expect, it } from 'vitest'
import { masteryTier, TIER_MIN_STABILITY_DAYS } from './mastery'
import { applyGrade, DAY_MS, type ReviewState } from './scheduler'
import { Grade } from './types'
import { corpusWordId } from './wordId'

const word = corpusWordId('en-000001')
const T0 = Date.UTC(2026, 0, 5)
const withStability = (stability: number): ReviewState => ({ ...applyGrade(null, word, Grade.Good, T0), stability })

describe('masteryTier', () => {
  it('is new until the word has state', () => {
    expect(masteryTier(null)).toBe('new')
    expect(masteryTier(undefined)).toBe('new')
  })

  it('switches tier exactly at the thresholds', () => {
    expect(masteryTier(withStability(TIER_MIN_STABILITY_DAYS.young - 0.01))).toBe('learning')
    expect(masteryTier(withStability(TIER_MIN_STABILITY_DAYS.young))).toBe('young')
    expect(masteryTier(withStability(TIER_MIN_STABILITY_DAYS.mature - 0.01))).toBe('young')
    expect(masteryTier(withStability(TIER_MIN_STABILITY_DAYS.mature))).toBe('mature')
  })

  it('walks a typical word from learning to young to mature', () => {
    let s = applyGrade(null, word, Grade.Good, T0)
    expect(masteryTier(s)).toBe('learning')
    s = applyGrade(s, word, Grade.Good, T0 + 2 * DAY_MS)
    expect(masteryTier(s)).toBe('young')
    s = applyGrade(s, word, Grade.Good, T0 + 13 * DAY_MS)
    expect(masteryTier(s)).toBe('mature')
  })

  it('drops a lapsed word back to learning', () => {
    let s = applyGrade(null, word, Grade.Easy, T0)
    s = applyGrade(s, word, Grade.Good, T0 + 8 * DAY_MS)
    s = applyGrade(s, word, Grade.Again, T0 + 40 * DAY_MS)
    expect(masteryTier(s)).toBe('learning')
  })
})
