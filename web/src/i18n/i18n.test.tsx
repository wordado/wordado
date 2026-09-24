import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bg } from './bg'
import { en } from './en'
import { I18nProvider, LOCALE_KEY, localized, translate, useT, type MessageKey } from './i18n'

afterEach(cleanup)

const placeholders = (message: string | { one: string; other: string }): string[] => {
  const text = typeof message === 'string' ? message : `${message.one} ${message.other}`
  return [...new Set(text.match(/\{\w+\}/g) ?? [])].sort()
}

describe('the message tables', () => {
  it('have the same keys, the same shape and the same placeholders in both languages', () => {
    expect(Object.keys(bg).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(typeof bg[key], key).toBe(typeof en[key])
      expect(placeholders(bg[key]), key).toEqual(placeholders(en[key]))
    }
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
  it('starts in Bulgarian, switches, remembers the choice and sets the document language', () => {
    const saved = new Map<string, string>()
    const storage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) }
    render(
      <I18nProvider storage={storage}>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByRole('button').textContent).toBe('Днес')
    expect(document.documentElement.lang).toBe('bg')
    act(() => screen.getByRole('button').click())
    expect(screen.getByRole('button').textContent).toBe('Today')
    expect(document.documentElement.lang).toBe('en')
    expect(saved.get(LOCALE_KEY)).toBe('en')
  })

  it('starts in the remembered language, and ignores a value it does not know', () => {
    const { unmount } = render(
      <I18nProvider storage={{ getItem: () => 'en', setItem: () => undefined }}>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByRole('button').textContent).toBe('Today')
    unmount()
    render(
      <I18nProvider storage={{ getItem: () => 'xx', setItem: () => undefined }}>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByRole('button').textContent).toBe('Днес')
  })

  it('works when storage throws (a private window)', () => {
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
    act(() => screen.getByRole('button').click())
    expect(screen.getByRole('button').textContent).toBe('Today')
  })
})
