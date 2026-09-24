import { describe, expect, it } from 'vitest'
import { parseWholeNumber } from './fields'

describe('parseWholeNumber', () => {
  it('accepts a whole number within the bounds, around spaces', () => {
    expect(parseWholeNumber('15', 0, 30)).toBe(15)
    expect(parseWholeNumber(' 0 ', 0, 30)).toBe(0)
    expect(parseWholeNumber('30', 0, 30)).toBe(30)
  })

  it('refuses everything else, so junk never reaches updateSettings', () => {
    for (const text of ['', ' ', '45', '-1', '2.5', '1e1', '0x10', 'ten', '１５', '15 words']) {
      expect(parseWholeNumber(text, 0, 30)).toBeNull()
    }
  })
})
