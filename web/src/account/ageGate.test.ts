import { describe, expect, it } from 'vitest'
import { checkBirthYear, consentAge, OUTSIDE_EEA_AGE, UNKNOWN_COUNTRY_AGE } from './ageGate'

const JUNE_2026 = new Date(2026, 5, 15).getTime()

describe('the age gate (spec §11)', () => {
  it('uses the member state’s age in the EEA, 16 when unknown, 13 elsewhere', () => {
    expect(consentAge('DE')).toBe(16)
    expect(consentAge('FR')).toBe(15)
    expect(consentAge('BG')).toBe(14)
    expect(consentAge('ES')).toBe(14)
    expect(consentAge('NO')).toBe(13)
    expect(consentAge(null)).toBe(UNKNOWN_COUNTRY_AGE)
    expect(consentAge('US')).toBe(OUTSIDE_EEA_AGE)
    expect(consentAge('GB')).toBe(13)
  })

  it('takes the youngest age a birth year allows', () => {
    // Born 2010: 15 or 16 in 2026. Germany needs 16, so the youngest possible age, 15, is turned away.
    expect(checkBirthYear('2010', 'DE', JUNE_2026)).toEqual({ status: 'too-young', age: 16 })
    expect(checkBirthYear('2009', 'DE', JUNE_2026)).toEqual({ status: 'ok' })
    expect(checkBirthYear('2011', 'BG', JUNE_2026)).toEqual({ status: 'ok' })
    expect(checkBirthYear('2012', 'BG', JUNE_2026)).toEqual({ status: 'too-young', age: 14 })
    expect(checkBirthYear('2012', 'US', JUNE_2026)).toEqual({ status: 'ok' })
    expect(checkBirthYear('2012', null, JUNE_2026)).toEqual({ status: 'too-young', age: 16 })
  })

  it('refuses a year that is not a plausible four-digit birth year', () => {
    for (const text of ['', '20', '19x0', '2027', '1899', '2026.5', ' 1990 1']) {
      expect(checkBirthYear(text, 'BG', JUNE_2026)).toEqual({ status: 'invalid' })
    }
    expect(checkBirthYear(' 1990 ', 'BG', JUNE_2026)).toEqual({ status: 'ok' })
  })
})
