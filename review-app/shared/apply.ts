import { csvRecords, formatCsv } from '@wordado/pipeline/csv'
import type { Action } from '../server/types'

export const ACTIONS: readonly Action[] = ['accept', 'keep', 'edit', 'drop']

/** What one queue lets a reviewer write (queueSpecs; the snapshot index carries the same values). */
export interface QueueRules {
  readonly columns: readonly string[]
  readonly verdicts: readonly string[]
}

export interface CsvDecision {
  readonly key: string
  readonly action: Action
  readonly cells?: Readonly<Record<string, string>> | undefined
  readonly note?: string | undefined
}

/**
 * Writes decisions into a review file's text as a reviewer editing the CSV would: the queue's editable cells, the
 * verdict (`drop` or `ok`) and the note (an empty note keeps the one there). Pure, so the Worker bundles it too
 * (spec 2026-10-05 §7.1).
 */
export function applyDecisions(
  text: string,
  rules: QueueRules,
  decisions: readonly CsvDecision[],
): { text: string; applied: string[]; missing: string[] } {
  const { header, rows } = csvRecords(text)
  const byKey = new Map(rows.map((r) => [(r['key'] ?? '').trim(), r]))
  const applied: string[] = []
  const missing: string[] = []
  for (const d of decisions) {
    const row = byKey.get(d.key)
    if (!row) {
      missing.push(d.key)
      continue
    }
    for (const col of rules.columns) if (d.cells && col in d.cells) row[col] = d.cells[col] ?? ''
    row['verdict'] = d.action === 'drop' ? 'drop' : 'ok'
    if (d.note !== undefined && d.note !== '') row['note'] = d.note
    applied.push(d.key)
  }
  if (applied.length === 0) return { text, applied, missing }
  return { text: formatCsv([header, ...rows.map((r) => header.map((c) => r[c] ?? ''))]), applied, missing }
}

/** Why no decision with this action can be written to the queue, or null. */
export function invalidDecision(rules: QueueRules, action: unknown): string | null {
  if (!(ACTIONS as readonly unknown[]).includes(action)) return `${String(action)} is not accept, keep, edit or drop`
  if (action === 'drop' && !rules.verdicts.includes('drop')) return 'this queue has no drop'
  return null
}
