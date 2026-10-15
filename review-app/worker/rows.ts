import type { RowView } from '../server/types'
import type { HostedRow, Progress } from '../shared/hosted'
import { inFlaggedScope, type DigestRow } from '../shared/snapshot'
import type { AssignmentRow, DecisionRow, SubmissionRow } from './db'
import type { Snapshot } from './snapshotStore'

export const rank = (r: RowView) => (r.reports !== '' ? 0 : r.severity === 'major' ? 1 : r.severity === 'minor' ? 2 : r.ai === 'unreviewed' || r.stale ? 3 : 4)

/** A row as progress counts it. */
export type RowHash = Pick<RowView, 'key' | 'rowHash'>

export function scopeFiles(snap: Snapshot, a: AssignmentRow): string[] {
  const inSnapshot = (snap.queue(a.queue)?.files ?? []).map((f) => f.file)
  return a.files === '*' ? inSnapshot : inSnapshot.filter((f) => a.files.includes(f))
}

/** Whether a row is one the assignment's reviewer may decide: for a spot check a row of its sample, otherwise any
 * row of its files. In both cases the file must still be open in the snapshot. */
export function inScope(snap: Snapshot, a: AssignmentRow, file: string, key: string): boolean {
  if (!scopeFiles(snap, a).includes(file)) return false
  return a.spotCheck === null || a.spotCheck.sample.some((s) => s.file === file && s.key === key)
}

/**
 * The assignment's rows (spec §6): flagged-only → flagged, reported or stale, worst first; otherwise every row in file order.
 * A spot check (spec §15): the rows of its sample that the snapshot still has, in the sample's own order, whatever
 * has become of them since (flagged, reported); `keys` are then those rows' keys and no others.
 * Null when a file the snapshot lists is missing from R2: the data is unavailable, not empty, so nobody may read
 * its rows as gone and discard decisions on them.
 */
export async function assignmentRows(snap: Snapshot, a: AssignmentRow): Promise<{ rows: RowView[]; keys: ReadonlySet<string> } | null> {
  if (a.spotCheck) {
    const byFile = new Map<string, Map<string, RowView>>()
    for (const f of scopeFiles(snap, a)) {
      const file = await snap.file(f)
      if (!file) return null
      byFile.set(f, new Map(file.rows.map((r) => [r.key, r])))
    }
    const rows = a.spotCheck.sample.flatMap((s) => byFile.get(s.file)?.get(s.key) ?? [])
    return { rows, keys: new Set(rows.map((r) => r.key)) }
  }
  const all: RowView[] = []
  for (const f of scopeFiles(snap, a)) {
    const file = await snap.file(f)
    if (!file) return null
    all.push(...file.rows)
  }
  const keys = new Set(all.map((r) => r.key))
  if (!a.flaggedOnly) return { rows: all, keys }
  return { rows: all.filter(inFlaggedScope).sort((x, y) => rank(x) - rank(y)), keys }
}

/**
 * The assignment's rows as assignmentRows gives them, in no particular order and only as progress and a spot
 * check's result count them. From the queue's digest when the snapshot has one, so that a list of assignments
 * parses no file (#279); otherwise from the files. Null as assignmentRows is, and when a file in scope is missing
 * from the digest.
 */
export async function assignmentHashes(snap: Snapshot, a: AssignmentRow): Promise<RowHash[] | null> {
  const digest = await snap.digest(a.queue)
  if (!digest) return (await assignmentRows(snap, a))?.rows ?? null
  const byFile = new Map<string, readonly DigestRow[]>()
  for (const f of scopeFiles(snap, a)) {
    if (!Object.hasOwn(digest.files, f)) return null
    byFile.set(f, digest.files[f]!)
  }
  const brief = ([key, rowHash]: DigestRow): RowHash => ({ key, rowHash })
  if (a.spotCheck) {
    const keyed = new Map([...byFile].map(([f, rows]) => [f, new Map(rows.map((r) => [r[0], r]))]))
    return a.spotCheck.sample.flatMap((s) => {
      const r = keyed.get(s.file)?.get(s.key)
      return r ? [brief(r)] : []
    })
  }
  return [...byFile.values()].flatMap((rows) => (a.flaggedOnly ? rows.filter(([, , flagged]) => flagged) : rows).map(brief))
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
      decision: { action: d.action, cells: d.cells, note: d.note, severity: d.severity, submission: d.submission, changed },
    }
  })
}

export function progress(rows: readonly RowHash[], decisions: readonly DecisionRow[], submissions: readonly SubmissionRow[]): Progress {
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
