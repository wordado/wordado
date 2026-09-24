/**
 * A whole number typed by the learner, within `min`–`max`; null for
 * anything else. Only ASCII digits: `Number()` alone would accept '1e1',
 * '0x10' and full-width digits.
 */
export function parseWholeNumber(text: string, min: number, max: number): number | null {
  const trimmed = text.trim()
  if (!/^\d{1,6}$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value >= min && value <= max ? value : null
}
