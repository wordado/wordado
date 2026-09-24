import type { LocalizedText } from '@wordado/core'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { bg } from './bg'
import { en, type Message, type MessageKey, type Messages } from './en'

export type { MessageKey }

export const LOCALES = ['bg', 'en'] as const
export type Locale = (typeof LOCALES)[number]

/** Each language named in itself, as language pickers do. The visible name is the accessible name (WCAG 2.5.3). */
export const ENDONYM: Readonly<Record<Locale, string>> = { bg: 'Български', en: 'English' }

/** The one localStorage key the app uses (spec §11.2: the interface language is the learner's choice). */
export const LOCALE_KEY = 'wordado.locale'

/** The lead L1 is the default until 6b reads the learner's own (spec §11.2). */
const DEFAULT_LOCALE: Locale = 'bg'

const MESSAGES: Readonly<Record<Locale, Messages>> = { bg, en }

export type Vars = Readonly<Record<string, string | number>>

export function translate(locale: Locale, key: MessageKey, vars: Vars = {}): string {
  const message: Message = MESSAGES[locale][key]
  const template =
    typeof message === 'string'
      ? message
      : new Intl.PluralRules(locale).select(Number(vars['count'] ?? 0)) === 'one'
        ? message.one
        : message.other
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

/** Pack text (unit titles, theme names) in the interface language: `l1` is the pack's own language (plan 3). */
export function localized(text: LocalizedText, locale: Locale): string {
  return locale === 'en' ? text.en : text.l1
}

type LocaleStorage = Pick<Storage, 'getItem' | 'setItem'>

function readLocale(storage: LocaleStorage | null): Locale {
  try {
    const saved = storage?.getItem(LOCALE_KEY)
    return LOCALES.find((l) => l === saved) ?? DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

interface I18nValue {
  readonly locale: Locale
  readonly setLocale: (locale: Locale) => void
  readonly t: (key: MessageKey, vars?: Vars) => string
}

const I18nContext = createContext<I18nValue | null>(null)

function defaultStorage(): LocaleStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function I18nProvider(props: { readonly storage?: LocaleStorage | null; readonly children?: ReactNode }) {
  const storage = props.storage === undefined ? defaultStorage() : props.storage
  const [locale, setState] = useState<Locale>(() => readLocale(storage))
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  const setLocale = useCallback(
    (next: Locale) => {
      setState(next)
      try {
        storage?.setItem(LOCALE_KEY, next)
      } catch {
        // A private window may refuse storage; the choice then lasts for this visit.
      }
    },
    [storage],
  )
  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t: (key, vars) => translate(locale, key, vars) }), [locale, setLocale])
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}

export function useT(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useT must be used inside an I18nProvider')
  return value
}
