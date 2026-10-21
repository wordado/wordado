import { describe, expect, it } from 'vitest'
import { courseSwitchPatch } from './course'
import { COURSE_L1S, DEFAULT_SETTINGS, isCourseL1 } from './settings'

describe('courses', () => {
  it('offers each course its own L1s, never the target itself', () => {
    expect(COURSE_L1S.en).toEqual(['bg', 'de', 'es'])
    expect(COURSE_L1S.de).toEqual(['bg', 'es', 'en'])
    expect(isCourseL1('de', 'de')).toBe(false)
    expect(isCourseL1('de', 'en')).toBe(true)
    expect(isCourseL1('en', 'en')).toBe(false)
  })
})

describe('courseSwitchPatch', () => {
  const english = { ...DEFAULT_SETTINGS, course: 'en' as const, l1: 'bg' as const, declaredLevel: 'B1' as const, activeTheme: 'food' }
  it('parks the current course and starts a new one empty', () => {
    expect(courseSwitchPatch(english, null, 'de')).toEqual({
      park: { l1: 'bg', declaredLevel: 'B1', activeTheme: 'food' },
      settings: { course: 'de', l1: null, declaredLevel: 'A1', activeTheme: null },
    })
  })
  it('restores a parked course', () => {
    const german = { ...english, course: 'de' as const, l1: 'en' as const, declaredLevel: 'A2' as const, activeTheme: null }
    expect(courseSwitchPatch(german, { l1: 'bg', declaredLevel: 'B1', activeTheme: 'food' }, 'en')).toEqual({
      park: { l1: 'en', declaredLevel: 'A2', activeTheme: null },
      settings: { course: 'en', l1: 'bg', declaredLevel: 'B1', activeTheme: 'food' },
    })
  })
  it('parks nothing for a course whose language was never chosen', () => {
    expect(courseSwitchPatch({ ...english, l1: null }, null, 'de').park).toBeNull()
  })
  it('does nothing when the course is the current one', () => {
    expect(courseSwitchPatch(english, null, 'en')).toEqual({ park: null, settings: {} })
  })
})
