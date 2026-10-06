import type { D1Database } from './bindings'
import type { Language, ReviewerView, Role } from '../shared/hosted'
import type { Action } from '../server/types'

export interface ReviewerRow {
  readonly email: string
  readonly name: string
  readonly languages: readonly Language[]
  readonly role: Role
  readonly invitedAt: string
  readonly inviteSentAt: string | null
  readonly disabledAt: string | null
}

interface ReviewerRecord { email: string; name: string; languages: string; role: Role; invited_at: string; invite_sent_at: string | null; disabled_at: string | null }
const reviewer = (r: ReviewerRecord): ReviewerRow => ({
  email: r.email, name: r.name, languages: JSON.parse(r.languages) as Language[], role: r.role,
  invitedAt: r.invited_at, inviteSentAt: r.invite_sent_at, disabledAt: r.disabled_at,
})

export async function getReviewer(db: D1Database, email: string): Promise<ReviewerRow | null> {
  const r = await db.prepare('SELECT * FROM reviewers WHERE email = ?').bind(email.toLowerCase()).first<ReviewerRecord>()
  return r ? reviewer(r) : null
}
export async function listReviewers(db: D1Database): Promise<ReviewerRow[]> {
  return (await db.prepare('SELECT * FROM reviewers ORDER BY name').all<ReviewerRecord>()).results.map(reviewer)
}
export async function insertReviewer(db: D1Database, r: ReviewerRow): Promise<void> {
  await db
    .prepare('INSERT INTO reviewers (email, name, languages, role, invited_at, invite_sent_at, disabled_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(r.email.toLowerCase(), r.name, JSON.stringify(r.languages), r.role, r.invitedAt, r.inviteSentAt, r.disabledAt)
    .run()
}
/** Inserts the reviewer unless the address is already there (two first requests racing); the row as stored. */
export async function insertReviewerIfAbsent(db: D1Database, r: ReviewerRow): Promise<ReviewerRow> {
  await db
    .prepare('INSERT INTO reviewers (email, name, languages, role, invited_at, invite_sent_at, disabled_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING')
    .bind(r.email.toLowerCase(), r.name, JSON.stringify(r.languages), r.role, r.invitedAt, r.inviteSentAt, r.disabledAt)
    .run()
  const stored = await getReviewer(db, r.email)
  if (!stored) throw new Error(`reviewer ${r.email} vanished after insert`)
  return stored
}
export async function updateReviewer(
  db: D1Database,
  email: string,
  patch: Partial<Pick<ReviewerRow, 'name' | 'languages' | 'role' | 'inviteSentAt' | 'disabledAt'>>,
): Promise<void> {
  const cols: Record<string, unknown> = {}
  if (patch.name !== undefined) cols['name'] = patch.name
  if (patch.languages !== undefined) cols['languages'] = JSON.stringify(patch.languages)
  if (patch.role !== undefined) cols['role'] = patch.role
  if (patch.inviteSentAt !== undefined) cols['invite_sent_at'] = patch.inviteSentAt
  if (patch.disabledAt !== undefined) cols['disabled_at'] = patch.disabledAt
  const names = Object.keys(cols)
  if (names.length === 0) return
  await db.prepare(`UPDATE reviewers SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE email = ?`).bind(...Object.values(cols), email.toLowerCase()).run()
}
export const toReviewerView = (r: ReviewerRow): ReviewerView => ({ ...r, languages: [...r.languages] })

export interface AssignmentRow { readonly id: number; readonly reviewer: string; readonly queue: string; readonly files: readonly string[] | '*'; readonly flaggedOnly: boolean; readonly createdAt: string; readonly closedAt: string | null }
interface AssignmentRecord { id: number; reviewer: string; queue: string; files: string; flagged_only: number; created_at: string; closed_at: string | null }
const assignment = (r: AssignmentRecord): AssignmentRow => ({
  id: r.id, reviewer: r.reviewer, queue: r.queue, files: r.files === '*' ? '*' : (JSON.parse(r.files) as string[]),
  flaggedOnly: r.flagged_only === 1, createdAt: r.created_at, closedAt: r.closed_at,
})
export async function getAssignment(db: D1Database, id: number): Promise<AssignmentRow | null> {
  const r = await db.prepare('SELECT * FROM assignments WHERE id = ?').bind(id).first<AssignmentRecord>()
  return r ? assignment(r) : null
}
export async function listAssignments(db: D1Database, filter: { reviewer?: string; open?: boolean; queue?: string } = {}): Promise<AssignmentRow[]> {
  const where: string[] = []
  const args: unknown[] = []
  if (filter.reviewer !== undefined) {
    where.push('reviewer = ?')
    args.push(filter.reviewer)
  }
  if (filter.queue !== undefined) {
    where.push('queue = ?')
    args.push(filter.queue)
  }
  if (filter.open === true) where.push('closed_at IS NULL')
  if (filter.open === false) where.push('closed_at IS NOT NULL')
  const sql = `SELECT * FROM assignments${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY closed_at IS NOT NULL, id DESC`
  return (await db.prepare(sql).bind(...args).all<AssignmentRecord>()).results.map(assignment)
}
export async function insertAssignment(db: D1Database, a: Omit<AssignmentRow, 'id' | 'closedAt'>): Promise<number> {
  const res = await db
    .prepare('INSERT INTO assignments (reviewer, queue, files, flagged_only, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(a.reviewer, a.queue, a.files === '*' ? '*' : JSON.stringify(a.files), a.flaggedOnly ? 1 : 0, a.createdAt)
    .run()
  return res.meta.last_row_id
}
export async function closeAssignment(db: D1Database, id: number, at: string): Promise<void> {
  await db.prepare('UPDATE assignments SET closed_at = ? WHERE id = ? AND closed_at IS NULL').bind(at, id).run()
}

export interface DecisionRow { readonly assignment: number; readonly queue: string; readonly file: string; readonly key: string; readonly rowHash: string; readonly action: Action; readonly cells: Readonly<Record<string, string>>; readonly note: string; readonly decidedAt: string; readonly submission: number | null }
interface DecisionRecord { assignment: number; queue: string; file: string; key: string; row_hash: string; action: Action; cells: string; note: string; decided_at: string; submission: number | null }
const decisionRow = (r: DecisionRecord): DecisionRow => ({
  assignment: r.assignment, queue: r.queue, file: r.file, key: r.key, rowHash: r.row_hash, action: r.action,
  cells: JSON.parse(r.cells) as Record<string, string>, note: r.note, decidedAt: r.decided_at, submission: r.submission,
})
export async function listDecisions(db: D1Database, assignmentId: number): Promise<DecisionRow[]> {
  return (await db.prepare('SELECT * FROM decisions WHERE assignment = ? ORDER BY file, key').bind(assignmentId).all<DecisionRecord>()).results.map(decisionRow)
}
export async function upsertDecision(db: D1Database, d: DecisionRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO decisions (assignment, queue, file, key, row_hash, action, cells, note, decided_at, submission) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (assignment, queue, key) DO UPDATE SET file = excluded.file, row_hash = excluded.row_hash, action = excluded.action,
       cells = excluded.cells, note = excluded.note, decided_at = excluded.decided_at, submission = excluded.submission`,
    )
    .bind(d.assignment, d.queue, d.file, d.key, d.rowHash, d.action, JSON.stringify(d.cells), d.note, d.decidedAt, d.submission)
    .run()
}
export async function deleteDecision(db: D1Database, assignmentId: number, key: string): Promise<void> {
  await db.prepare('DELETE FROM decisions WHERE assignment = ? AND key = ? AND submission IS NULL').bind(assignmentId, key).run()
}
export async function deleteDecisions(db: D1Database, assignmentId: number, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  await db.batch(keys.map((k) => db.prepare('DELETE FROM decisions WHERE assignment = ? AND key = ? AND submission IS NULL').bind(assignmentId, k)))
}
export async function moveDecisions(db: D1Database, from: number, to: number): Promise<void> {
  await db.prepare('UPDATE decisions SET assignment = ? WHERE assignment = ? AND submission IS NULL').bind(to, from).run()
}
export async function markSubmitted(db: D1Database, assignmentId: number, keys: readonly string[], submission: number): Promise<void> {
  await db.batch(keys.map((k) => db.prepare('UPDATE decisions SET submission = ? WHERE assignment = ? AND key = ? AND submission IS NULL').bind(submission, assignmentId, k)))
}
export async function unsubmit(db: D1Database, submission: number): Promise<void> {
  await db.prepare('UPDATE decisions SET submission = NULL WHERE submission = ?').bind(submission).run()
}

export interface SubmissionRow { readonly id: number; readonly assignment: number; readonly branch: string; readonly pr: number | null; readonly url: string | null; readonly count: number; readonly leftOut: number; readonly status: 'open' | 'merged' | 'closed'; readonly createdAt: string }
interface SubmissionRecord { id: number; assignment: number; branch: string; pr: number | null; url: string | null; count: number; left_out: number; status: SubmissionRow['status']; created_at: string }
const submissionRow = (r: SubmissionRecord): SubmissionRow => ({ id: r.id, assignment: r.assignment, branch: r.branch, pr: r.pr, url: r.url, count: r.count, leftOut: r.left_out, status: r.status, createdAt: r.created_at })
export async function insertSubmission(db: D1Database, s: Omit<SubmissionRow, 'id'>): Promise<number> {
  const res = await db
    .prepare('INSERT INTO submissions (assignment, branch, pr, url, count, left_out, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(s.assignment, s.branch, s.pr, s.url, s.count, s.leftOut, s.status, s.createdAt)
    .run()
  return res.meta.last_row_id
}
/**
 * Claims a submit: a submission with no pull request yet, and the given unsubmitted decisions marked with it.
 * Null when the assignment already has a claim (the unique index submissions_claim), so two submits at once
 * cannot both go to GitHub.
 */
export async function claimSubmission(db: D1Database, s: Pick<SubmissionRow, 'assignment' | 'branch' | 'count' | 'leftOut' | 'createdAt'>, keys: readonly string[]): Promise<number | null> {
  let id: number
  try {
    id = await insertSubmission(db, { ...s, pr: null, url: null, status: 'open' })
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(err instanceof Error ? err.message : String(err))) return null
    throw err
  }
  await markSubmitted(db, s.assignment, keys, id)
  return id
}
/** The assignment's claim that has no pull request yet, if any. */
export async function pendingClaim(db: D1Database, assignmentId: number): Promise<SubmissionRow | null> {
  const r = await db.prepare("SELECT * FROM submissions WHERE assignment = ? AND pr IS NULL AND status = 'open'").bind(assignmentId).first<SubmissionRecord>()
  return r ? submissionRow(r) : null
}
export async function setSubmissionBranch(db: D1Database, id: number, branch: string): Promise<void> {
  await db.prepare('UPDATE submissions SET branch = ? WHERE id = ?').bind(branch, id).run()
}
export async function completeSubmission(db: D1Database, id: number, pr: number, url: string): Promise<void> {
  await db.prepare('UPDATE submissions SET pr = ?, url = ? WHERE id = ?').bind(pr, url, id).run()
}
/** Gives a claim up: its decisions are unsubmitted again and the claim is gone. */
export async function releaseSubmission(db: D1Database, id: number): Promise<void> {
  await db.batch([db.prepare('UPDATE decisions SET submission = NULL WHERE submission = ?').bind(id), db.prepare('DELETE FROM submissions WHERE id = ? AND pr IS NULL').bind(id)])
}
export async function listSubmissions(db: D1Database, filter: { assignment?: number; status?: SubmissionRow['status'] } = {}): Promise<SubmissionRow[]> {
  const where: string[] = []
  const args: unknown[] = []
  if (filter.assignment !== undefined) {
    where.push('assignment = ?')
    args.push(filter.assignment)
  }
  if (filter.status !== undefined) {
    where.push('status = ?')
    args.push(filter.status)
  }
  const sql = `SELECT * FROM submissions${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC`
  return (await db.prepare(sql).bind(...args).all<SubmissionRecord>()).results.map(submissionRow)
}
export async function submissionByPr(db: D1Database, pr: number): Promise<SubmissionRow | null> {
  const r = await db.prepare('SELECT * FROM submissions WHERE pr = ?').bind(pr).first<SubmissionRecord>()
  return r ? submissionRow(r) : null
}
export async function setSubmissionStatus(db: D1Database, id: number, status: SubmissionRow['status']): Promise<void> {
  await db.prepare('UPDATE submissions SET status = ? WHERE id = ?').bind(status, id).run()
}
