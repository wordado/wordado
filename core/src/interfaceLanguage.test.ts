import { describe, expect, it } from 'vitest'
import { ANNOUNCEMENT_LANGUAGES } from './announcement'
import { INTERFACE_LANGUAGES, isInterfaceLanguage } from './interfaceLanguage'
import { NEWS_CONSENT_LANGUAGES } from './newsConsent'

describe('the interface languages (#199)', () => {
  it('are the four the app speaks, and nothing else is one', () => {
    for (const language of ['bg', 'de', 'en', 'es']) expect(isInterfaceLanguage(language)).toBe(true)
    for (const value of ['fr', 'BG', 'en-GB', ' en', '', null, undefined, 1, ['en'], { language: 'en' }]) expect(isInterfaceLanguage(value)).toBe(false)
  })

  it('are the languages an announcement is written in and the news question is asked in', () => {
    expect([...ANNOUNCEMENT_LANGUAGES]).toEqual([...INTERFACE_LANGUAGES])
    expect([...NEWS_CONSENT_LANGUAGES]).toEqual([...INTERFACE_LANGUAGES])
  })
})
