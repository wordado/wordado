/** The languages Wordado teaches (spec §1, §5.5). A course is a target and an L1. */
export const TARGETS = ['en', 'de'] as const
export type Target = (typeof TARGETS)[number]
export const isTarget = (v: unknown): v is Target => typeof v === 'string' && (TARGETS as readonly string[]).includes(v)

/** Entry and unit IDs of every target but English start with this, so two courses never share an ID (§5.5). */
export const ENTRY_ID_PREFIX: Readonly<Record<Target, string>> = { en: '', de: 'de.' }

/** A course pack's ID: English keeps the IDs its clients already hold. */
export function coursePackId(target: string, l1: string): string {
  return target === 'en' ? `corpus-${l1}` : `corpus-${target}-${l1}`
}

/** The target an entry belongs to, from its ID's prefix. */
export function targetOfEntryId(entryId: string): Target {
  for (const t of TARGETS) if (ENTRY_ID_PREFIX[t] !== '' && entryId.startsWith(ENTRY_ID_PREFIX[t])) return t
  return 'en'
}
