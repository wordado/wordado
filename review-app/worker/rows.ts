import type { RowView } from '../server/types'
import type { HostedRow, Progress } from '../shared/hosted'
import type { AssignmentRow, DecisionRow, SubmissionRow } from './db'
import type { Snapshot } from './snapshotStore'

export const rank = (r: RowView) => (r.reports !== '' ? 0 : r.severity === 'major' ? 1 : r.severity === 'minor' ? 2 : r.ai === 'unreviewed' ? 3 : 4)

export function scopeFiles(snap: Snapshot, a: AssignmentRow): string[] {
  const inSnapshot = (snap.queue(a.queue)?.files ?? []).map((f) => f.file)
  return a.files === '*' ? inSnapshot : inSnapshot.filter((f) => a.files.includes(f))
}

/**
 * The assignment's rows (spec §6): flagged-only → flagged or reported, worst first; otherwise every row in file order.
 * Null when a file the snapshot lists is missing from R2: the data is unavailable, not empty, so nobody may read
 * its rows as gone and discard decisions on them.
 */
export async function assignmentRows(snap: Snapshot, a: AssignmentRow): Promise<{ rows: RowView[]; keys: ReadonlySet<string> } | null> {
  const all: RowView[] = []
  for (const f of scopeFiles(snap, a)) {
    const file = await snap.file(f)
    if (!file) return null
    all.push(...file.rows)
  }
  const keys = new Set(all.map((r) => r.key))
  if (!a.flaggedOnly) return { rows: all, keys }
  return { rows: all.filter((r) => r.ai === 'flagged' || r.reports !== '').sort((x, y) => rank(x) - rank(y)), keys }
}

export function withDecisions(rows: readonly RowView[], decisions: readonly DecisionRow[]): HostedRow[] {
  const byKey = new Map(decisions.map((d) => [d.key, d]))
  return rows.map((r) => {
    const d = byKey.get(r.key)
    if (!d) return { ...r, decided: null, decision: null }
    const changed = d.rowHash !== r.rowHash
    return {
      ...r,
      decided: changed ? null : { verdict: d.action === 'drop' ? 'drop' : 'ok', note: d.note },
      decision: { action: d.action, cells: d.cells, note: d.note, submission: d.submission, changed },
    }
  })
}

export function progress(rows: readonly RowView[], decisions: readonly DecisionRow[], submissions: readonly SubmissionRow[]): Progress {
  const hash = new Map(rows.map((r) => [r.key, r.rowHash]))
  const open = new Set(submissions.filter((s) => s.status === 'open').map((s) => s.id))
  let decided = 0
  let changed = 0
  let submitted = 0
  for (const d of decisions) {
    if (!hash.has(d.key)) continue
    if (d.submission !== null && open.has(d.submission)) submitted += 1
    else if (d.submission !== null) continue
    else if (hash.get(d.key) !== d.rowHash) changed += 1
    else decided += 1
  }
  const merged = submissions.filter((s) => s.status === 'merged').reduce((n, s) => n + s.count, 0)
  return { inScope: rows.length, decided, changed, submitted, merged, remaining: rows.length - decided - submitted }
}
