import type { Pack } from './pack'
import type { PackError } from './validation'

export interface SuccessionOptions {
  /**
   * The units were rebuilt once (spec 2026-10-06 §3.6): a unit of the previous version may be gone. The app
   * derives a learner's path from the words they have met, so only saved unlocks are lost. Entries never may go.
   */
  readonly allowRemovedUnits?: boolean
}

/**
 * What version n+1 of a pack owes version n (spec §5.1): the same pack and
 * L1, a higher corpus version, a schema that does not go back, and every
 * entry and unit ID still present — a retired entry stays in the pack. The
 * pipeline runs this against the last published pack before publishing.
 */
export function checkPackSuccession(previous: Pack, next: Pack, opts: SuccessionOptions = {}): PackError[] {
  const errors: PackError[] = []
  if (next.pack_id !== previous.pack_id) errors.push({ path: 'pack_id', message: `must stay ${previous.pack_id}` })
  if (next.l1 !== previous.l1) errors.push({ path: 'l1', message: `must stay ${previous.l1}` })
  if (next.corpus_version <= previous.corpus_version) {
    errors.push({ path: 'corpus_version', message: `must be greater than ${previous.corpus_version}` })
  }
  if (next.schema_version < previous.schema_version) errors.push({ path: 'schema_version', message: 'must not go back' })
  const entries = new Set(next.entries.map((e) => e.entry_id))
  for (const e of previous.entries) {
    if (!entries.has(e.entry_id)) errors.push({ path: 'entries', message: `entry ${e.entry_id} was removed; retire it instead` })
  }
  if (!opts.allowRemovedUnits) {
    const units = new Set(next.units.map((u) => u.unit_id))
    for (const u of previous.units) {
      if (!units.has(u.unit_id)) errors.push({ path: 'units', message: `unit ${u.unit_id} was removed` })
    }
  }
  return errors
}
