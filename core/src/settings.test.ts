import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, isValidTzOffset, MAX_REVIEW_CAP, validateSettingsPatch } from './settings'
import { MAX_NEW_WORD_LIMIT } from './session'

function errorsOf(patch: Record<string, unknown>): string[] {
  const result = validateSettingsPatch(patch)
  return result.ok ? [] : [...result.errors]
}

describe('validateSettingsPatch', () => {
  it('accepts a valid partial patch and returns only the named fields', () => {
    const result = validateSettingsPatch({ newWordLimit: 15, dailyGoal: null, activeTheme: 'food' })
    expect(result).toEqual({ ok: true, fields: { newWordLimit: 15, dailyGoal: null, activeTheme: 'food' } })
  })

  it('keeps every value inside the bounds core assumes', () => {
    expect(errorsOf({ newWordLimit: -1 })).toEqual(['newWordLimit'])
    expect(errorsOf({ newWordLimit: MAX_NEW_WORD_LIMIT + 1 })).toEqual(['newWordLimit'])
    expect(errorsOf({ newWordLimit: 2.5 })).toEqual(['newWordLimit'])
    expect(errorsOf({ newWordLimit: Number.NaN })).toEqual(['newWordLimit'])
    expect(errorsOf({ reviewCap: MAX_REVIEW_CAP + 1 })).toEqual(['reviewCap'])
    expect(errorsOf({ reviewCap: 0 })).toEqual([])
    expect(errorsOf({ retention: 'extreme' })).toEqual(['retention'])
    expect(errorsOf({ retention: 'relaxed' })).toEqual([])
    expect(errorsOf({ dailyGoal: 0 })).toEqual(['dailyGoal'])
    expect(errorsOf({ dailyGoal: 1 })).toEqual([])
    expect(errorsOf({ declaredLevel: 'Z9' })).toEqual(['declaredLevel'])
    expect(errorsOf({ activeTheme: 3 })).toEqual(['activeTheme'])
    expect(errorsOf({ audio: 'yes' })).toEqual(['audio'])
  })

  it('rejects unknown fields and collects every error', () => {
    expect(errorsOf({ newWordLimit: 99, colour: 'blue' })).toEqual(['newWordLimit', 'colour'])
  })

  it('has defaults that validate', () => {
    expect(validateSettingsPatch({ ...DEFAULT_SETTINGS }).ok).toBe(true)
  })
})

describe('isValidTzOffset', () => {
  it('accepts integers within −720…+840 and nothing else', () => {
    expect(isValidTzOffset(120)).toBe(true)
    expect(isValidTzOffset(-720)).toBe(true)
    expect(isValidTzOffset(840)).toBe(true)
    expect(isValidTzOffset(841)).toBe(false)
    expect(isValidTzOffset(-721)).toBe(false)
    expect(isValidTzOffset(90.5)).toBe(false)
    expect(isValidTzOffset(Number.NaN)).toBe(false)
  })
})
