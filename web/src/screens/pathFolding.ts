/** Where a unit stands on the path (spec §7.2). */
export type UnitStatus = 'locked' | 'current' | 'complete' | 'mastered' | 'open'

export type LevelStatus = 'skipped' | 'complete' | 'locked' | 'open'

/** Units that need nothing more from the learner. */
export const isDone = (status: UnitStatus): boolean => status === 'complete' || status === 'mastered'

/** Units after the current one shown before "Show all". */
export const NEXT_UNITS_SHOWN = 2

/**
 * The level the path opens on: the one holding the current unit, else the
 * first with work left, else the last. The others start folded.
 */
export function levelToOpen(levels: readonly { readonly level: string; readonly statuses: readonly UnitStatus[] }[]): string | undefined {
  return (
    levels.find((l) => l.statuses.includes('current'))?.level ??
    levels.find((l) => l.statuses.some((s) => s !== 'locked' && !isDone(s)))?.level ??
    levels.at(-1)?.level
  )
}

/** What a folded level says about itself. */
export function levelStatus(statuses: readonly UnitStatus[], skipped: boolean): LevelStatus {
  if (skipped) return 'skipped'
  if (statuses.every(isDone)) return 'complete'
  if (statuses.every((s) => s === 'locked')) return 'locked'
  return 'open'
}

/**
 * The open level at first sight, as unit indexes: the finished units (folded
 * into one line); every unit with work left up to the current one, and the
 * next few after it; and how many wait behind "Show all". A unit before the
 * current one that is not yet complete stays in view: it is still being learned.
 */
export function unitsAtFirst(statuses: readonly UnitStatus[], next: number = NEXT_UNITS_SHOWN): { done: number[]; shown: number[]; hidden: number } {
  const done = statuses.flatMap((s, i) => (isDone(s) ? [i] : []))
  const rest = statuses.flatMap((s, i) => (isDone(s) ? [] : [i]))
  const current = rest.indexOf(statuses.indexOf('current'))
  const shown = rest.slice(0, (current === -1 ? 0 : current) + 1 + next)
  return { done, shown, hidden: statuses.length - done.length - shown.length }
}
