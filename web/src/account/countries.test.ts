import { describe, expect, it } from 'vitest'
import { CONSENT_AGE } from './ageGate'
import { COUNTRY_CODES, countryOptions } from './countries'

describe('countries', () => {
  it('lists every ISO 3166-1 alpha-2 code once', () => {
    expect(COUNTRY_CODES).toHaveLength(249)
    expect(new Set(COUNTRY_CODES).size).toBe(249)
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/)
    for (const code of Object.keys(CONSENT_AGE)) expect(COUNTRY_CODES).toContain(code)
  })

  it('names them in the interface language, in that language’s order', () => {
    const bg = countryOptions('bg')
    expect(bg.find((c) => c.code === 'BG')?.name).toBe('България')
    const en = countryOptions('en')
    expect(en.find((c) => c.code === 'DE')?.name).toBe('Germany')
    const names = en.map((c) => c.name)
    expect(names).toEqual([...names].sort(new Intl.Collator('en').compare))
  })
})
