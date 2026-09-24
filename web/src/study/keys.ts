import type { RunPhase } from '@wordado/client-data'
import type { Grade, StudyItem } from '@wordado/core'

export type KeyAction =
  | { readonly kind: 'choose'; readonly index: number }
  | { readonly kind: 'rate'; readonly grade: Grade }
  | { readonly kind: 'reveal' }
  | { readonly kind: 'next' }

const DIGITS: Readonly<Record<string, number>> = { '1': 1, '2': 2, '3': 3, '4': 4 }

/** The keyboard for every mode (spec §11.1): 1–4 answer or rate, Space and Enter reveal and continue. */
export function keyAction(key: string, phase: RunPhase, item: StudyItem | null): KeyAction | null {
  if (!item) return null
  const digit = DIGITS[key]
  const confirm = key === ' ' || key === 'Enter'
  if (item.mode === 'flashcard') {
    if (phase === 'prompt' && confirm) return { kind: 'reveal' }
    if (phase === 'revealed' && digit !== undefined) return { kind: 'rate', grade: digit as Grade }
    return null
  }
  if (phase === 'prompt' && digit !== undefined && digit <= item.options.length) return { kind: 'choose', index: digit - 1 }
  if (phase === 'feedback' && confirm) return { kind: 'next' }
  return null
}
