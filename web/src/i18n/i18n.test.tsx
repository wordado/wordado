import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bg } from './bg'
import { de } from './de'
import { en } from './en'
import { I18nProvider, initialLocale, LOCALE_KEY, localized, translate, useT, type MessageKey } from './i18n'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const placeholders = (message: string | { one: string; other: string }): string[] => {
  const text = typeof message === 'string' ? message : `${message.one} ${message.other}`
  return [...new Set(text.match(/\{\w+\}/g) ?? [])].sort()
}

describe('the message tables', () => {
  it('have the same keys, the same shape and the same placeholders in every language', () => {
    for (const table of [bg, de]) {
      expect(Object.keys(table).sort()).toEqual(Object.keys(en).sort())
      for (const key of Object.keys(en) as MessageKey[]) {
        expect(typeof table[key], key).toBe(typeof en[key])
        expect(placeholders(table[key]), key).toEqual(placeholders(en[key]))
      }
    }
  })
})

describe('initialLocale', () => {
  it('prefers a saved choice over the browser languages', () => {
    expect(initialLocale({ getItem: () => 'bg', setItem: () => undefined }, ['de'])).toBe('bg')
  })

  it('falls back to the first supported browser language', () => {
    expect(initialLocale(null, ['de-AT', 'en'])).toBe('de')
    expect(initialLocale(null, ['fr-FR', 'bg'])).toBe('bg')
  })

  it('falls back to English when nothing is saved or supported', () => {
    expect(initialLocale(null, ['fr'])).toBe('en')
  })

  it('falls back to the browser languages when storage throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(initialLocale(storage, ['de-AT'])).toBe('de')
  })

  it('matches a browser language tag regardless of case', () => {
    expect(initialLocale(null, ['DE-AT'])).toBe('de')
  })
})

describe('translate', () => {
  it('fills placeholders and picks the plural form by count', () => {
    expect(translate('en', 'home.newWords', { count: 1 })).toBe('1 new word')
    expect(translate('en', 'home.newWords', { count: 5 })).toBe('5 new words')
    expect(translate('bg', 'home.newWords', { count: 1 })).toBe('1 нова дума')
    expect(translate('bg', 'home.newWords', { count: 5 })).toBe('5 нови думи')
    expect(translate('en', 'home.xp', { today: 30, total: 120 })).toBe('30 XP today, 120 in all')
  })

  it('picks the German plural form (one for 1, other for 2)', () => {
    expect(translate('de', 'home.newWords', { count: 1 })).toBe('1 neues Wort')
    expect(translate('de', 'home.newWords', { count: 2 })).toBe('2 neue Wörter')
  })

  it('leaves a placeholder it was not given visible, rather than printing undefined', () => {
    expect(translate('en', 'home.xp', { today: 30 })).toBe('30 XP today, {total} in all')
  })

  it('reads pack text in the interface language', () => {
    expect(localized({ en: 'Food', l1: 'Храна' }, 'en')).toBe('Food')
    expect(localized({ en: 'Food', l1: 'Храна' }, 'bg')).toBe('Храна')
  })
})

function Probe() {
  const { t, locale, setLocale } = useT()
  return (
    <button type="button" onClick={() => setLocale(locale === 'bg' ? 'en' : 'bg')}>
      {t('nav.home')}
    </button>
  )
}

describe('I18nProvider', () => {
  it('with no saved value, starts in English (the default, spec §11.2 Decision 4), switches, remembers the choice and sets the document language', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US', 'en'])
    const saved = new Map<string, string>()
    const storage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) }
    render(
      <I18nProvider storage={storage}>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByRole('button').textContent).toBe('Today')
    expect(document.documentElement.lang).toBe('en')
    act(() => screen.getByRole('button').click())
    expect(screen.getByRole('button').textContent).toBe('Днес')
    expect(document.documentElement.lang).toBe('bg')
    expect(saved.get(LOCALE_KEY)).toBe('bg')
  })

  it('starts in the remembered language, and falls back to the browser (then English) for a value it does not know', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR'])
    const { unmount } = render(
      <I18nProvider storage={{ getItem: () => 'bg', setItem: () => undefined }}>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByRole('button').textContent).toBe('Днес')
    unmount()
    render(
      <I18nProvider storage={{ getItem: () => 'xx', setItem: () => undefined }}>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByRole('button').textContent).toBe('Today')
  })

  it('works when storage throws (a private window), falling back to English', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR'])
    const storage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    render(
      <I18nProvider storage={storage}>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByRole('button').textContent).toBe('Today')
    act(() => screen.getByRole('button').click())
    expect(screen.getByRole('button').textContent).toBe('Днес')
  })
})
