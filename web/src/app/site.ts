import type { Locale } from '../i18n/i18n'

/** The public website (wordado/wordado-site). The app is at app.wordado.com; the site holds the legal pages. */
export const SITE_URL = 'https://wordado.com'

/** The privacy policy in the interface language. The website has every interface language (LOCALES). */
export function privacyUrl(locale: Locale): string {
  return `${SITE_URL}/${locale}/privacy/`
}
