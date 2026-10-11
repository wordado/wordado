import { describe, expect, it } from 'vitest'
import { isNewsConsentText, NEWS_CONSENT_LANGUAGES, NEWS_CONSENT_WORDING, newsConsentText } from './newsConsent'

describe('the wording of the consent to news (#186)', () => {
  it('names the wording and the language it was read in', () => {
    expect(newsConsentText('bg')).toBe(`${NEWS_CONSENT_WORDING}.bg`)
    for (const language of NEWS_CONSENT_LANGUAGES) expect(isNewsConsentText(newsConsentText(language))).toBe(true)
  })

  it('knows no other wording, no other language, and nothing that is not text', () => {
    for (const value of ['news-0.bg', 'news-1.fr', 'news-1', '.bg', 'news-1.', '', true, null, undefined, 1]) expect(isNewsConsentText(value)).toBe(false)
  })
})
