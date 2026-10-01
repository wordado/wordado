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

export function consentAge(country: string | null): number {
  if (country === null) return UNKNOWN_COUNTRY_AGE
  return CONSENT_AGE[country] ?? OUTSIDE_EEA_AGE
}
