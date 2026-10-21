import { describe, expect, it } from 'vitest'
import { PROFILES, profileOf } from './profiles'

describe('profiles', () => {
  it('defaults to English', () => {
    expect(profileOf({}).code).toBe('en')
    expect(profileOf({ target: 'de' }).code).toBe('de')
  })
  it('keeps English exactly as the pipeline has always been', () => {
    const en = PROFILES.en
    expect(en.course).toBe('an English vocabulary course')
    expect(en.idPrefix).toBe('')
    expect(en.accents).toEqual(['uk', 'us'])
    expect(en.reviewQueue).toBe('english')
    expect(en.grammar).toBeNull()
    expect(en.senseGrammarLine).toBe('')
  })
  it('describes German', () => {
    const de = PROFILES.de
    expect(de.course).toBe('a German vocabulary course')
    expect(de.idPrefix).toBe('de.')
    expect(de.transliterate).toEqual({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })
    expect(de.accents).toEqual(['de'])
    expect(de.reviewQueue).toBe('german')
    expect(Object.keys(de.grammar!)).toEqual(['gender', 'plural', 'separable', 'irregular', 'auxiliary'])
  })
})
