import { useClientSnapshot } from '@wordado/client-data'
import type { Unit } from '@wordado/core'

/**
 * The unit a practice route names (spec §7.4), or null for practice over everything: no unit in the address, one the
 * corpus does not hold, or one still locked.
 */
export function usePracticeUnit(unitId: string | undefined): Unit | null {
  const { corpus, path } = useClientSnapshot()
  if (unitId === undefined || !path?.unlocked.has(unitId)) return null
  return corpus?.units.find((unit) => unit.unitId === unitId) ?? null
}
