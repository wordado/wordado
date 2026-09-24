/**
 * The age of digital consent per EEA country: the member states' choices
 * under GDPR Article 8, with Iceland, Liechtenstein and Norway (spec §11).
 *
 * PROVISIONAL: spec §15's legal review of this table is still open. This
 * file is the one place to change it.
 */
export const CONSENT_AGE: Readonly<Record<string, number>> = {
  AT: 14, BE: 13, BG: 14, CY: 14, CZ: 15, DE: 16, DK: 13, EE: 13, ES: 14, FI: 13,
  FR: 15, GR: 15, HR: 16, HU: 16, IE: 16, IS: 13, IT: 14, LI: 16, LT: 14, LU: 16,
  LV: 13, MT: 13, NL: 16, NO: 13, PL: 16, PT: 13, RO: 16, SE: 13, SI: 15, SK: 16,
}

/** When the learner does not say where they live: the highest EEA age (spec §11). */
export const UNKNOWN_COUNTRY_AGE = 16
/** Outside the EEA (spec §11). */
export const OUTSIDE_EEA_AGE = 13
export const MIN_BIRTH_YEAR = 1900

export function consentAge(country: string | null): number {
  if (country === null) return UNKNOWN_COUNTRY_AGE
  return CONSENT_AGE[country] ?? OUTSIDE_EEA_AGE
}

export type BirthYearCheck = { readonly status: 'ok' } | { readonly status: 'invalid' } | { readonly status: 'too-young'; readonly age: number }

/**
 * Whether a learner who gives `text` as their birth year may sign up where
 * they live (spec §11). Only the year is asked, so the youngest age it
 * allows is used: born in 2010, a learner is 15 until their birthday in 2026.
 * The year is never stored.
 */
export function checkBirthYear(text: string, country: string | null, now: number): BirthYearCheck {
  const trimmed = text.trim()
  if (!/^\d{4}$/.test(trimmed)) return { status: 'invalid' }
  const year = Number(trimmed)
  const current = new Date(now).getFullYear()
  if (year < MIN_BIRTH_YEAR || year > current) return { status: 'invalid' }
  const age = consentAge(country)
  return current - year - 1 >= age ? { status: 'ok' } : { status: 'too-young', age }
}
