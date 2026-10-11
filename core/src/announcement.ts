/**
 * A mail to account holders, written in the review app and sent by the server (#185). The two kinds are kept
 * apart: a service notice (changed terms, planned downtime, shutdown) is part of providing the service and goes
 * to every account holder; news (new features) goes only to accounts that consented to it (newsConsent.ts), and
 * every such mail carries a link that withdraws the consent.
 */
export const ANNOUNCEMENT_KINDS = ['service', 'news'] as const
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number]
export const isAnnouncementKind = (v: unknown): v is AnnouncementKind => typeof v === 'string' && (ANNOUNCEMENT_KINDS as readonly string[]).includes(v)

/** The languages an announcement can be written in: the app's interface languages. */
export const ANNOUNCEMENT_LANGUAGES = ['bg', 'de', 'en', 'es'] as const
export type AnnouncementLanguage = (typeof ANNOUNCEMENT_LANGUAGES)[number]
export const isAnnouncementLanguage = (v: unknown): v is AnnouncementLanguage => typeof v === 'string' && (ANNOUNCEMENT_LANGUAGES as readonly string[]).includes(v)
/** The language every announcement has: what an account gets when there is no text in its own, or its own is not known. */
export const ANNOUNCEMENT_FALLBACK_LANGUAGE = 'en' satisfies AnnouncementLanguage

/** The longest subject, in characters: one line in a list of mail. */
export const MAX_ANNOUNCEMENT_SUBJECT = 150
/** The longest body, in characters: a few screens of plain text. */
export const MAX_ANNOUNCEMENT_BODY = 10_000

export interface AnnouncementText {
  readonly subject: string
  /** Plain text. A link is its address written out. */
  readonly body: string
}

export type AnnouncementTexts = { readonly [L in AnnouncementLanguage]?: AnnouncementText } & { readonly en: AnnouncementText }

export type AnnouncementTextsValidation = { readonly ok: true; readonly texts: AnnouncementTexts } | { readonly ok: false; readonly errors: readonly string[] }

// Control characters, and the line and paragraph separators some programs break a line at.
const CONTROL = /[\p{Cc}\u2028\u2029]/u
const CONTROL_BUT_NEW_LINE_AND_TAB = /[^\P{Cc}\n\t]|[\u2028\u2029]/u

/**
 * Checks the texts of an announcement and puts them in the form they are kept and mailed in: trimmed, every line
 * ending the same, a language with nothing written left out. English is needed. A subject is one line with no
 * control character, so it cannot start a header of its own; a body is plain text, which is all the mail carries,
 * so nothing in it is markup to a mail program.
 */
export function validateAnnouncementTexts(input: unknown): AnnouncementTextsValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, errors: ['texts must be an object of languages'] }
  const errors: string[] = []
  const texts: { [L in AnnouncementLanguage]?: AnnouncementText } = {}
  const given = input as Record<string, unknown>
  for (const language of Object.keys(given).sort()) {
    if (!isAnnouncementLanguage(language)) errors.push(`${language}: not a language of the app`)
  }
  for (const language of ANNOUNCEMENT_LANGUAGES) {
    const raw = given[language]
    if (raw === undefined && language !== ANNOUNCEMENT_FALLBACK_LANGUAGE) continue
    const { subject: rawSubject, body: rawBody } = (typeof raw === 'object' && raw !== null ? raw : {}) as { subject?: unknown; body?: unknown }
    const subject = typeof rawSubject === 'string' ? rawSubject.trim() : ''
    const body = typeof rawBody === 'string' ? rawBody.replace(/\r\n?/g, '\n').trim() : ''
    if (subject === '' && body === '' && typeof rawSubject === 'string' && typeof rawBody === 'string' && language !== ANNOUNCEMENT_FALLBACK_LANGUAGE) continue
    if (subject === '' || body === '') errors.push(`${language}: a subject and a body are needed`)
    else if (CONTROL.test(subject)) errors.push(`${language}: the subject must be one line of plain text`)
    else if (subject.length > MAX_ANNOUNCEMENT_SUBJECT) errors.push(`${language}: the subject is longer than ${MAX_ANNOUNCEMENT_SUBJECT} characters`)
    else if (CONTROL_BUT_NEW_LINE_AND_TAB.test(body)) errors.push(`${language}: the body must be plain text`)
    else if (body.length > MAX_ANNOUNCEMENT_BODY) errors.push(`${language}: the body is longer than ${MAX_ANNOUNCEMENT_BODY} characters`)
    else texts[language] = { subject, body }
  }
  return errors.length > 0 || !texts.en ? { ok: false, errors } : { ok: true, texts: texts as AnnouncementTexts }
}

/** The text an account of `language` gets: its own where the announcement has one, English otherwise. */
export function announcementTextFor(texts: AnnouncementTexts, language: AnnouncementLanguage): { readonly language: AnnouncementLanguage; readonly text: AnnouncementText } {
  const own = texts[language]
  return own ? { language, text: own } : { language: ANNOUNCEMENT_FALLBACK_LANGUAGE, text: texts.en }
}
