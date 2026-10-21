import { describe, expect, it } from 'vitest'
import { coursePackId, isTarget, targetOfEntryId, TARGETS } from './target'

describe('targets', () => {
  it('knows English and German', () => {
    expect(TARGETS).toEqual(['en', 'de'])
    expect(isTarget('de')).toBe(true)
    expect(isTarget('fr')).toBe(false)
  })
  it('keeps English pack IDs and prefixes the others', () => {
    expect(coursePackId('en', 'bg')).toBe('corpus-bg')
    expect(coursePackId('de', 'bg')).toBe('corpus-de-bg')
  })
  it('reads the target from an entry ID', () => {
    expect(targetOfEntryId('bank-1')).toBe('en')
    expect(targetOfEntryId('de.bank-1')).toBe('de')
    expect(targetOfEntryId('dew-1')).toBe('en')
  })
})
