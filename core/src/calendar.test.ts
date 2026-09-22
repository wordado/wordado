import { describe, expect, it } from 'vitest'
import { dayToIsoDate, isoDateToDay, monthOf, utcDay } from './calendar'
import { DAY_MS, localDay } from './scheduler'

describe('calendar', () => {
  it('turns a day number into the ISO date day_complete stores, and back', () => {
    const day = localDay(Date.UTC(2026, 0, 5, 23, 30), 120) // 6 January in Sofia
    expect(dayToIsoDate(day)).toBe('2026-01-06')
    expect(isoDateToDay('2026-01-06')).toBe(day)
    expect(isoDateToDay('1970-01-01')).toBe(0)
  })

  it('rejects malformed and impossible dates', () => {
    expect(() => isoDateToDay('2026-1-6')).toThrow()
    expect(() => isoDateToDay('2026-02-30')).toThrow()
    expect(() => isoDateToDay('06/01/2026')).toThrow()
  })

  it('counts UTC days for the XP cap, whatever the learner\'s offset', () => {
    const ts = Date.UTC(2026, 0, 5, 23, 30)
    expect(utcDay(ts)).toBe(localDay(ts, 0))
    expect(utcDay(ts)).toBe(Math.floor(ts / DAY_MS))
    expect(utcDay(ts + 30 * 60_000)).toBe(utcDay(ts) + 1)
  })

  it('groups days by calendar month', () => {
    expect(monthOf(isoDateToDay('2026-01-31'))).toBe(monthOf(isoDateToDay('2026-01-01')))
    expect(monthOf(isoDateToDay('2026-02-01'))).toBe(monthOf(isoDateToDay('2026-01-31')) + 1)
    expect(monthOf(isoDateToDay('2027-01-01'))).toBe(monthOf(isoDateToDay('2026-01-01')) + 12)
  })
})
