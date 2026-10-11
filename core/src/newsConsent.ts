/**
 * Consent to news by email (#186): asked with an unticked checkbox at sign-up, withdrawn from the settings. None
 * is an account that was never asked or never said yes; withdrawn is one that said yes and took it back.
 */
export const NEWS_CONSENT_STATES = ['none', 'given', 'withdrawn'] as const
export type NewsConsent = (typeof NEWS_CONSENT_STATES)[number]

/**
 * The wording the learner agrees to (`news.consent` in the app's interface text). A new number whenever its
 * meaning changes in any language; the old ones stay in NEWS_CONSENT_WORDINGS, since a browser may still show them.
 */
export const NEWS_CONSENT_WORDING = 'news-1'
export const NEWS_CONSENT_WORDINGS: readonly string[] = [NEWS_CONSENT_WORDING]
/** The languages the wording exists in: the app's interface languages. */
export const NEWS_CONSENT_LANGUAGES: readonly string[] = ['bg', 'de', 'en', 'es']

/** What is recorded beside a consent: the wording and the language it was read in, as `news-1.bg`. */
export function newsConsentText(language: string, wording: string = NEWS_CONSENT_WORDING): string {
  return `${wording}.${language}`
}

/** Whether `value` names a wording this version knows, in a language it exists in. */
export function isNewsConsentText(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const dot = value.lastIndexOf('.')
  return dot > 0 && NEWS_CONSENT_WORDINGS.includes(value.slice(0, dot)) && NEWS_CONSENT_LANGUAGES.includes(value.slice(dot + 1))
}
