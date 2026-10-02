import type { Locale } from '../i18n/i18n'

/** The public website (wordado/wordado-site). The app is at app.wordado.com; the site holds the legal pages. */
export const SITE_URL = 'https://wordado.com'

/** The interface languages the website has pages in. Spanish waits for the site's /es/privacy/ (plan 12). */
export const SITE_LOCALES: ReadonlySet<Locale> = new Set(['bg', 'de', 'en'])

/** The privacy policy in the interface language, or in English where the website has no page in it yet. */
export function privacyUrl(locale: Locale): string {
  return `${SITE_URL}/${SITE_LOCALES.has(locale) ? locale : 'en'}/privacy/`
}
