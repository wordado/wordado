import type { Locale } from '../i18n/i18n'

/** The public website (wordado/wordado-site). The app is at app.wordado.com; the site holds the legal pages. */
export const SITE_URL = 'https://wordado.com'

/** The interface languages the website has pages in (wordado-site `LANGUAGES`); any other falls back to English. */
export const SITE_LOCALES: ReadonlySet<Locale> = new Set(['bg', 'de', 'en', 'es'])

/** The website's language for an interface language: its own, or English where the website has no pages in it yet. */
export function siteLocale(locale: Locale): Locale {
  return SITE_LOCALES.has(locale) ? locale : 'en'
}

/** The legal pages a change of which the app tells its learners about (#184). */
export const LEGAL_DOCS = ['terms', 'privacy'] as const
export type LegalDoc = (typeof LEGAL_DOCS)[number]

/** A legal page in the interface language, or in English where the website has no page in it yet. */
export function legalUrl(doc: LegalDoc, locale: Locale): string {
  return `${SITE_URL}/${siteLocale(locale)}/${doc}/`
}

/** The privacy policy in the interface language, or in English where the website has no page in it yet. */
export function privacyUrl(locale: Locale): string {
  return legalUrl('privacy', locale)
}

/** When each language's terms and privacy policy last changed: a small file the website's build writes from the pages. */
export const LEGAL_DATES_URL = `${SITE_URL}/legal.json`
