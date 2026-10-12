import { describe, expect, it } from 'vitest'
import { LOCALES } from '../i18n/i18n'
import { parseRoute, SETTINGS_SECTIONS } from '../router'
import { guidePageUrl, guideSlug, guideUrl, LEGAL_DATES_URL, legalUrl, privacyUrl, SITE_URL } from './site'

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

describe('guideUrl', () => {
  it('is the user guide’s start page on the website, in the interface language', () => {
    expect(guideUrl('bg')).toBe('https://wordado.com/bg/guide/')
    expect(guideUrl('en')).toBe('https://wordado.com/en/guide/')
  })
})

describe('guidePageUrl', () => {
  it('is one page of the guide, in the interface language', () => {
    expect(guidePageUrl('first-session', 'en')).toBe('https://wordado.com/en/guide/first-session/')
    expect(guidePageUrl('reminders', 'bg')).toBe('https://wordado.com/bg/guide/reminders/')
  })
})

describe('guideSlug', () => {
  const at = (path: string) => guideSlug(parseRoute(path, ''))

  it('names the guide’s page about each screen that has one', () => {
    expect(at('/')).toBe('first-session')
    expect(at('/path')).toBe('path-and-themes')
    expect(guideSlug(parseRoute('/path', '?unit=u1'))).toBe('path-and-themes')
    expect(at('/themes')).toBe('path-and-themes')
    expect(at('/themes/food')).toBe('path-and-themes')
    expect(at('/search')).toBe('search-and-set-aside')
    expect(at('/progress')).toBe('progress-and-streak')
    expect(at('/practice')).toBe('practice')
    expect(at('/signin')).toBe('account')
    expect(at('/settings/native-language')).toBe('languages')
  })

  it('follows the section of the settings', () => {
    expect(SETTINGS_SECTIONS.map((section) => [section, guideSlug({ name: 'settings', section })])).toEqual([
      ['study', 'study-settings'],
      ['words', 'search-and-set-aside'],
      ['audio', 'offline-and-devices'],
      ['reminders', 'reminders'],
      ['languages', 'languages'],
      ['account', 'account'],
      ['app', null],
      ['about', null],
    ])
    expect(at('/settings')).toBeNull()
  })

  it('has no page for the other screens', () => {
    for (const path of ['/study', '/practice/words', '/practice/matching', '/settings/placement', '/feedback']) expect(at(path)).toBeNull()
  })
})
