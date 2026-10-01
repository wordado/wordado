import { describe, expect, it } from 'vitest'
import { consentAge, OUTSIDE_EEA_AGE, UNKNOWN_COUNTRY_AGE } from './ageGate'

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
})
