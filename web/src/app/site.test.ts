import { describe, expect, it } from 'vitest'
import { LOCALES } from '../i18n/i18n'
import { privacyUrl, SITE_URL } from './site'

describe('privacyUrl', () => {
  it('is the website’s privacy page in the interface language', () => {
    expect(SITE_URL).toBe('https://wordado.com')
    expect(LOCALES.map((l) => privacyUrl(l))).toEqual([
      'https://wordado.com/bg/privacy/',
      'https://wordado.com/de/privacy/',
      'https://wordado.com/en/privacy/',
    ])
  })
})
