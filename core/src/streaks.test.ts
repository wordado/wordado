import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isoDateToDay } from './calendar'
import { isDayComplete, STREAK_FREEZES_PER_MONTH, streakStatus, type DayCompleteInput } from './streaks'

const d = (iso: string) => isoDateToDay(iso)
const range = (from: string, to: string) => {
  const out: number[] = []
  for (let day = d(from); day <= d(to); day += 1) out.push(day)
  return out
}

describe('isDayComplete', () => {
  const base: DayCompleteInput = { backlogTotal: 0, reviewCap: 100, reviewsDoneToday: 0, answeredToday: 0, dailyGoal: null }

  it('needs at least one answer, even when nothing is due', () => {
    expect(isDayComplete(base)).toBe(false)
    expect(isDayComplete({ ...base, answeredToday: 1 })).toBe(true)
  })

  it('counts the day when the capped due figure is finished', () => {
    expect(isDayComplete({ ...base, backlogTotal: 3, answeredToday: 5 })).toBe(false)
    expect(isDayComplete({ ...base, backlogTotal: 250, reviewsDoneToday: 100, answeredToday: 100 })).toBe(true)
    expect(isDayComplete({ ...base, backlogTotal: 250, reviewsDoneToday: 99, answeredToday: 99 })).toBe(false)
  })

  it('counts the day when the daily goal is met, whatever is still due', () => {
    expect(isDayComplete({ ...base, backlogTotal: 40, answeredToday: 20, dailyGoal: 20 })).toBe(true)
    expect(isDayComplete({ ...base, backlogTotal: 40, answeredToday: 19, dailyGoal: 20 })).toBe(false)
  })
})

describe('streakStatus', () => {
  it('is zero with no completed day', () => {
    expect(streakStatus([], d('2026-03-10'))).toEqual({ length: 0, todayComplete: false, freezesLeft: 2 })
  })

  it('counts consecutive completed days up to today', () => {
    const days = range('2026-03-01', '2026-03-10')
    expect(streakStatus(days, d('2026-03-10')).length).toBe(10)
    expect(streakStatus(days, d('2026-03-10')).todayComplete).toBe(true)
  })

  it('does not break until the day is over', () => {
    const days = range('2026-03-01', '2026-03-09')
    expect(streakStatus(days, d('2026-03-10'))).toMatchObject({ length: 9, todayComplete: false })
  })

  it('spends a freeze on a missed day, silently, and counts the frozen day', () => {
    const days = [...range('2026-03-01', '2026-03-04'), ...range('2026-03-06', '2026-03-08')]
    expect(streakStatus(days, d('2026-03-08'))).toEqual({ length: 8, todayComplete: true, freezesLeft: 1 })
  })

  it('breaks on the third missed day of a month', () => {
    const days = [d('2026-03-01'), d('2026-03-05'), d('2026-03-06')]
    expect(streakStatus(days, d('2026-03-06'))).toMatchObject({ length: 2, freezesLeft: 0 })
    const twoMisses = [d('2026-03-01'), d('2026-03-04'), d('2026-03-05')]
    expect(streakStatus(twoMisses, d('2026-03-05'))).toMatchObject({ length: 5, freezesLeft: 0 })
  })

  it('gives each calendar month its own freezes', () => {
    // Four misses in a row across the month boundary: two in January, two in February.
    const across = [...range('2026-01-28', '2026-01-29'), d('2026-02-03')]
    expect(streakStatus(across, d('2026-02-03'))).toEqual({ length: 7, todayComplete: true, freezesLeft: 0 })
    // Three misses, all in February.
    const inFeb = [...range('2026-01-29', '2026-01-31'), d('2026-02-04')]
    expect(streakStatus(inFeb, d('2026-02-04'))).toMatchObject({ length: 1, freezesLeft: 0 })
  })

  it('starts on a completed day: leading misses never count', () => {
    expect(streakStatus([d('2026-03-05')], d('2026-03-06')).length).toBe(1)
    expect(streakStatus([d('2026-03-05')], d('2026-03-09')).length).toBe(0)
  })

  it('is unchanged by anything but the set of dates', () => {
    const days = range('2026-03-01', '2026-03-10')
    expect(streakStatus(days, d('2026-03-10'))).toEqual(streakStatus([...days].reverse(), d('2026-03-10')))
    expect(streakStatus([...days, ...days], d('2026-03-10'))).toEqual(streakStatus(days, d('2026-03-10')))
  })

  it('never gets shorter when a late-syncing device adds a date', () => {
    const today = d('2026-06-30')
    const arbDays = fc.uniqueArray(fc.integer({ min: today - 120, max: today }), { maxLength: 60 })
    fc.assert(
      fc.property(arbDays, fc.integer({ min: today - 120, max: today }), (days, added) => {
        const before = streakStatus(days, today).length
        const after = streakStatus([...days, added], today).length
        expect(after).toBeGreaterThanOrEqual(before)
      }),
    )
  })

  it('exposes the freezes per month as a constant the UI can show', () => {
    expect(STREAK_FREEZES_PER_MONTH).toBe(2)
  })
})
