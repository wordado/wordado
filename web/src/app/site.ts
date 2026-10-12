import type { Locale } from '../i18n/i18n'
import type { Route } from '../router'

/** The public website (wordado/wordado-site). The app is at app.wordado.com; the site holds the legal pages. */
export const SITE_URL = 'https://wordado.com'

/** The interface languages the website has pages in (wordado-site `LANGUAGES`); any other falls back to English. */
export const SITE_LOCALES: ReadonlySet<Locale> = new Set(['bg', 'de', 'en', 'es'])

/** The website's language for an interface language: its own, or English where the website has no pages in it yet. */
export function siteLocale(locale: Locale): Locale {
  return SITE_LOCALES.has(locale) ? locale : 'en'
}

/** The user guide's start page in the interface language, or in English where the website has no pages in it yet. */
export function guideUrl(locale: Locale): string {
  return `${SITE_URL}/${siteLocale(locale)}/guide/`
}

/** The guide's pages the app leads to from its screens (the website's `guide/<slug>` files). */
export type GuideSlug =
  | 'first-session'
  | 'path-and-themes'
  | 'search-and-set-aside'
  | 'progress-and-streak'
  | 'practice'
  | 'study-settings'
  | 'offline-and-devices'
  | 'reminders'
  | 'languages'
  | 'account'

/** One page of the user guide in the interface language, or in English where the website has no pages in it yet. */
export function guidePageUrl(slug: GuideSlug, locale: Locale): string {
  return `${guideUrl(locale)}${slug}/`
}

/** The guide's page about a screen (#243), or null where the guide has none for it. */
export function guideSlug(route: Route): GuideSlug | null {
  switch (route.name) {
    case 'home':
      return 'first-session'
    case 'path':
    case 'themes':
    case 'theme':
      return 'path-and-themes'
    case 'search':
      return 'search-and-set-aside'
    case 'progress':
      return 'progress-and-streak'
    case 'practice':
      return 'practice'
    case 'signin':
      return 'account'
    case 'native-language':
      return 'languages'
    case 'settings':
      switch (route.section) {
        case 'study':
          return 'study-settings'
        case 'words':
          return 'search-and-set-aside'
        case 'audio':
          return 'offline-and-devices'
        case 'reminders':
          return 'reminders'
        case 'languages':
          return 'languages'
        case 'account':
          return 'account'
        default:
          return null
      }
    default:
      return null
  }
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
