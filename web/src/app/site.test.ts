import { describe, expect, it } from 'vitest'
import { LOCALES } from '../i18n/i18n'
import { LEGAL_DATES_URL, legalUrl, privacyUrl, SITE_URL } from './site'

describe('privacyUrl', () => {
  it('is the website’s privacy page in the interface language', () => {
    expect(SITE_URL).toBe('https://wordado.com')
    expect(LOCALES.map((l) => privacyUrl(l))).toEqual([
      'https://wordado.com/bg/privacy/',
      'https://wordado.com/de/privacy/',
      'https://wordado.com/en/privacy/',
      'https://wordado.com/es/privacy/',
    ])
  })
})

describe('legalUrl', () => {
  it('is the website’s page of that document in the interface language', () => {
    expect(LOCALES.map((l) => legalUrl('terms', l))).toEqual([
      'https://wordado.com/bg/terms/',
      'https://wordado.com/de/terms/',
      'https://wordado.com/en/terms/',
      'https://wordado.com/es/terms/',
    ])
    expect(legalUrl('privacy', 'de')).toBe(privacyUrl('de'))
  })
})

describe('LEGAL_DATES_URL', () => {
  it('is the website’s file of the legal pages’ dates', () => {
    expect(LEGAL_DATES_URL).toBe('https://wordado.com/legal.json')
  })
})
