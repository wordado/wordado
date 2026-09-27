import { canonicalJson, type Pack, type PackEntry, type ReportField } from '@wordado/core'
import type { Fix, FixesFile } from './lastPublished'

const FIELDS: readonly [ReportField, (e: PackEntry) => unknown][] = [
  ['audio', (e) => e.audio],
  ['example', (e) => e.examples],
  ['level', (e) => e.level],
  ['translation', (e) => [e.translation, e.alternates, e.sense]],
]

/** The report fields (spec §8.10) whose values changed between two versions, per entry both carry. */
export function diffFixes(previous: Pack | null, next: Pack): Fix[] {
  if (!previous) return []
  const before = new Map(previous.entries.map((e) => [e.entry_id, e]))
  const out: Fix[] = []
  for (const e of [...next.entries].sort((a, b) => (a.entry_id < b.entry_id ? -1 : 1))) {
    const old = before.get(e.entry_id)
    if (!old) continue
    for (const [field, value] of FIELDS) {
      if (canonicalJson(value(old)) !== canonicalJson(value(e))) out.push({ word_id: `c:${e.entry_id}`, field, fixed_in: next.corpus_version })
    }
  }
  return out
}

/** `fixes.json` is cumulative: a learner whose report is older than several versions still finds its fix (plan 8b). */
export function nextFixesFile(previous: FixesFile, fixes: readonly Fix[], version: number): FixesFile {
  return { schema_version: 1, corpus_version: version, fixes: [...previous.fixes, ...fixes] }
}
