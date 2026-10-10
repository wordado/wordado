import type { D1Database } from './bindings'
import { MAX_FEEDBACK_NOTE_LENGTH, type FeedbackAi, type FeedbackCategory, type FeedbackSeverity, type FeedbackState, type FeedbackTopicRef, type FeedbackTopicView, type Language, type ReviewerView, type Role, type SampleRef, type Severity, type TopicIssueState } from '../shared/hosted'
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

/** A spot check's sample (spec §15): the seed it was drawn with and its rows, in the order they are shown. */
export interface SpotCheck { readonly seed: number; readonly sample: readonly SampleRef[] }
/** `spotCheck` is null for an assignment of files; a spot check's `files` are the files its sample was drawn from. */
export interface AssignmentRow { readonly id: number; readonly reviewer: string; readonly queue: string; readonly files: readonly string[] | '*'; readonly flaggedOnly: boolean; readonly spotCheck: SpotCheck | null; readonly createdAt: string; readonly closedAt: string | null }
interface AssignmentRecord { id: number; reviewer: string; queue: string; files: string; flagged_only: number; spot_check: number; seed: number | null; sample: string | null; created_at: string; closed_at: string | null }
const assignment = (r: AssignmentRecord): AssignmentRow => ({
  id: r.id, reviewer: r.reviewer, queue: r.queue, files: r.files === '*' ? '*' : (JSON.parse(r.files) as string[]),
  flaggedOnly: r.flagged_only === 1, spotCheck: r.spot_check === 1 ? { seed: r.seed ?? 0, sample: JSON.parse(r.sample ?? '[]') as SampleRef[] } : null,
  createdAt: r.created_at, closedAt: r.closed_at,
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
export async function insertAssignment(db: D1Database, a: Omit<AssignmentRow, 'id' | 'closedAt' | 'spotCheck'> & { readonly spotCheck?: SpotCheck | null }): Promise<number> {
  const spot = a.spotCheck ?? null
  const res = await db
    .prepare('INSERT INTO assignments (reviewer, queue, files, flagged_only, spot_check, seed, sample, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(a.reviewer, a.queue, a.files === '*' ? '*' : JSON.stringify(a.files), a.flaggedOnly ? 1 : 0, spot ? 1 : 0, spot ? spot.seed : null, spot ? JSON.stringify(spot.sample) : null, a.createdAt)
    .run()
  return res.meta.last_row_id
}
export async function closeAssignment(db: D1Database, id: number, at: string): Promise<void> {
  await db.prepare('UPDATE assignments SET closed_at = ? WHERE id = ? AND closed_at IS NULL').bind(at, id).run()
}

export interface DecisionRow { readonly assignment: number; readonly queue: string; readonly file: string; readonly key: string; readonly rowHash: string; readonly action: Action; readonly cells: Readonly<Record<string, string>>; readonly note: string; readonly severity: Severity | null; readonly decidedAt: string; readonly submission: number | null }
interface DecisionRecord { assignment: number; queue: string; file: string; key: string; row_hash: string; action: Action; cells: string; note: string; severity: Severity | null; decided_at: string; submission: number | null }
const decisionRow = (r: DecisionRecord): DecisionRow => ({
  assignment: r.assignment, queue: r.queue, file: r.file, key: r.key, rowHash: r.row_hash, action: r.action,
  cells: JSON.parse(r.cells) as Record<string, string>, note: r.note, severity: r.severity, decidedAt: r.decided_at, submission: r.submission,
})
export async function listDecisions(db: D1Database, assignmentId: number): Promise<DecisionRow[]> {
  return (await db.prepare('SELECT * FROM decisions WHERE assignment = ? ORDER BY file, key').bind(assignmentId).all<DecisionRecord>()).results.map(decisionRow)
}
/** The rows of a queue that a decision in an open or merged submission already settles, as key → the row hash decided on. */
export async function settledRows(db: D1Database, queue: string): Promise<Map<string, Set<string>>> {
  const found = await db
    .prepare("SELECT d.key AS key, d.row_hash AS row_hash FROM decisions d JOIN submissions s ON s.id = d.submission WHERE d.queue = ? AND s.status IN ('open', 'merged')")
    .bind(queue)
    .all<{ key: string; row_hash: string }>()
  const out = new Map<string, Set<string>>()
  for (const r of found.results) out.set(r.key, (out.get(r.key) ?? new Set()).add(r.row_hash))
  return out
}
export async function upsertDecision(db: D1Database, d: Omit<DecisionRow, 'severity'> & { readonly severity?: Severity | null }): Promise<void> {
  await db
    .prepare(
      `INSERT INTO decisions (assignment, queue, file, key, row_hash, action, cells, note, severity, decided_at, submission) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (assignment, queue, key) DO UPDATE SET file = excluded.file, row_hash = excluded.row_hash, action = excluded.action,
       cells = excluded.cells, note = excluded.note, severity = excluded.severity, decided_at = excluded.decided_at, submission = excluded.submission`,
    )
    .bind(d.assignment, d.queue, d.file, d.key, d.rowHash, d.action, JSON.stringify(d.cells), d.note, d.severity ?? null, d.decidedAt, d.submission)
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
/** Whether a claim other than `id` names this branch (a submit of another assignment that is using it). */
export async function branchClaimedByOther(db: D1Database, branch: string, id: number): Promise<boolean> {
  return (await db.prepare("SELECT id FROM submissions WHERE branch = ? AND pr IS NULL AND status = 'open' AND id != ?").bind(branch, id).first()) !== null
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

/** The coordinator's mark on a learner's feedback (spec §16), by the message's id at the learner app's server. */
export interface FeedbackMarkRow { readonly state: FeedbackState; readonly note: string; readonly updatedAt: string; readonly updatedBy: string }
/** The marks of these messages, by id; a message nobody has marked is not in it. At most a page of ids (D1 binds 100 values). */
export async function feedbackMarks(db: D1Database, ids: readonly number[]): Promise<Map<number, FeedbackMarkRow>> {
  const out = new Map<number, FeedbackMarkRow>()
  if (ids.length === 0) return out
  const found = await db
    .prepare(`SELECT feedback_id, state, note, updated_at, updated_by FROM feedback_marks WHERE feedback_id IN (${ids.map(() => '?').join(', ')})`)
    .bind(...ids)
    .all<{ feedback_id: number; state: FeedbackState; note: string; updated_at: string; updated_by: string }>()
  for (const r of found.results) out.set(r.feedback_id, { state: r.state, note: r.note, updatedAt: r.updated_at, updatedBy: r.updated_by })
  return out
}
export async function putFeedbackMark(db: D1Database, id: number, mark: FeedbackMarkRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO feedback_marks (feedback_id, state, note, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (feedback_id) DO UPDATE SET state = excluded.state, note = excluded.note, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(id, mark.state, mark.note, mark.updatedAt, mark.updatedBy)
    .run()
}

/** How long a run may hold a week without finishing before the next run takes it. */
const WEEKLY_CLAIM_MS = 60 * 60 * 1000
/** Takes the week for this run: true when no other run has it. A claim left unfinished for an hour is given up first. */
export async function claimWeeklyMail(db: D1Database, week: string, now: Date): Promise<boolean> {
  await db.prepare('DELETE FROM weekly_mails WHERE week = ? AND messages IS NULL AND claimed_at < ?').bind(week, new Date(now.getTime() - WEEKLY_CLAIM_MS).toISOString()).run()
  const claimed = await db.prepare('INSERT INTO weekly_mails (week, claimed_at) VALUES (?, ?) ON CONFLICT (week) DO NOTHING').bind(week, now.toISOString()).run()
  return claimed.meta.changes === 1
}
/** The run ended: how many messages the week had, and when the mail went (null: none was sent). */
export async function settleWeeklyMail(db: D1Database, week: string, messages: number, sentAt: string | null): Promise<void> {
  await db.prepare('UPDATE weekly_mails SET messages = ?, sent_at = ? WHERE week = ?').bind(messages, sentAt, week).run()
}
/** The run failed: the week is free for the next try. */
export async function releaseWeeklyMail(db: D1Database, week: string): Promise<void> {
  await db.prepare('DELETE FROM weekly_mails WHERE week = ? AND messages IS NULL').bind(week).run()
}

/** The AI's reading of a message as it is kept (spec 2026-10-10 §4): with the message's own time, the model and the
 * prompt version that made it, and the topic the reading puts it in (none when left out). */
export interface FeedbackAiRow extends FeedbackAi { readonly receivedAt: number; readonly model: string; readonly promptVersion: number; readonly createdAt: string; readonly topicId?: number | null }
/** A reading as it is read back: with the topic the message is in now, its title, and who put it there. */
export interface FeedbackAiStored extends FeedbackAiRow { readonly topicId: number | null; readonly topicBy: 'ai' | 'coordinator'; readonly topicTitle: string | null }
interface FeedbackAiRecord { feedback_id: number; received_at: number; language: string; translation: string; category: FeedbackCategory; severity: FeedbackSeverity | null; summary: string; model: string; prompt_version: number; created_at: string; topic_id: number | null; topic_by: 'ai' | 'coordinator'; topic_title: string | null }
/** The AI's readings of these messages, by id; a message it has not read is not in it. At most a page of ids (D1 binds 100 values). */
export async function feedbackAiRows(db: D1Database, ids: readonly number[]): Promise<Map<number, FeedbackAiStored>> {
  const out = new Map<number, FeedbackAiStored>()
  if (ids.length === 0) return out
  const found = await db
    .prepare(`SELECT a.*, t.title AS topic_title FROM feedback_ai a LEFT JOIN feedback_topics t ON t.id = a.topic_id WHERE a.feedback_id IN (${ids.map(() => '?').join(', ')})`)
    .bind(...ids)
    .all<FeedbackAiRecord>()
  for (const r of found.results) {
    out.set(r.feedback_id, {
      language: r.language, translation: r.translation, category: r.category, severity: r.severity, summary: r.summary, receivedAt: r.received_at, model: r.model, promptVersion: r.prompt_version, createdAt: r.created_at,
      topicId: r.topic_id, topicBy: r.topic_by, topicTitle: r.topic_title,
    })
  }
  return out
}
/**
 * Keeps these readings, each in place of the one its message had: one batch. A reading brings its message's topic,
 * except for a message the coordinator moved: that one keeps the coordinator's topic whatever the reading says
 * (spec 2026-10-10 §3.2). A topic that is gone by now leaves the message with none.
 */
export async function putFeedbackAi(db: D1Database, rows: ReadonlyMap<number, FeedbackAiRow>): Promise<void> {
  if (rows.size === 0) return
  const put = db.prepare(
    `INSERT INTO feedback_ai (feedback_id, received_at, language, translation, category, severity, summary, model, prompt_version, created_at, topic_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM feedback_topics WHERE id = ?))
     ON CONFLICT (feedback_id) DO UPDATE SET received_at = excluded.received_at, language = excluded.language, translation = excluded.translation, category = excluded.category,
       severity = excluded.severity, summary = excluded.summary, model = excluded.model, prompt_version = excluded.prompt_version, created_at = excluded.created_at,
       topic_id = CASE WHEN feedback_ai.topic_by = 'coordinator' THEN feedback_ai.topic_id ELSE excluded.topic_id END`,
  )
  await db.batch([...rows].map(([id, r]) => put.bind(id, r.receivedAt, r.language, r.translation, r.category, r.severity, r.summary, r.model, r.promptVersion, r.createdAt, r.topicId ?? null)))
}
/** Drops the readings between two ids whose message the server no longer gives: how many. `kept` is at most a page of ids. */
export async function dropFeedbackAiNotIn(db: D1Database, lowest: number, highest: number, kept: readonly number[]): Promise<number> {
  const not = kept.length > 0 ? ` AND feedback_id NOT IN (${kept.map(() => '?').join(', ')})` : ''
  return (await db.prepare(`DELETE FROM feedback_ai WHERE feedback_id BETWEEN ? AND ?${not}`).bind(lowest, highest, ...kept).run()).meta.changes
}
/** Drops the readings of these messages: how many. At most a page of ids. */
export async function dropFeedbackAi(db: D1Database, ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0
  return (await db.prepare(`DELETE FROM feedback_ai WHERE feedback_id IN (${ids.map(() => '?').join(', ')})`).bind(...ids).run()).meta.changes
}
/** Drops every reading: how many. With them go the topics nobody has worked on, which the AI alone made, and the
 * paragraphs it wrote about a week; a topic the coordinator renamed, marked, noted or matched stays, empty. The
 * marks and the count of calls stay. */
export async function forgetFeedbackAi(db: D1Database): Promise<number> {
  const [readings] = (await db.batch([db.prepare('DELETE FROM feedback_ai'), db.prepare('DELETE FROM feedback_topics WHERE updated_by IS NULL'), db.prepare('DELETE FROM feedback_week_texts')])) as { meta: { changes: number } }[]
  return readings?.meta.changes ?? 0
}

interface TopicRecord { id: number; title: string; state: FeedbackState; note: string; issue: number | null; issue_state: TopicIssueState; issue_title: string | null; n: number; newest: number | null; worst: number | null }
const WORST: readonly (FeedbackSeverity | null)[] = [null, 'blocks', 'annoys', 'cosmetic']
const topicView = (r: TopicRecord): FeedbackTopicView => ({
  id: r.id, title: r.title, state: r.state, note: r.note, issue: r.issue, issueState: r.issue_state, issueTitle: r.issue_title, count: r.n, newestAt: r.newest, worst: WORST[r.worst ?? 0] ?? null,
})
/** A topic with what is counted of its messages: one query. The worst severity is the lowest of 1 (blocks) to 3 (cosmetic). */
const TOPICS = `SELECT t.id, t.title, t.state, t.note, t.issue, t.issue_state, o.title AS issue_title, COUNT(a.feedback_id) AS n, MAX(a.received_at) AS newest,
    MIN(CASE a.severity WHEN 'blocks' THEN 1 WHEN 'annoys' THEN 2 WHEN 'cosmetic' THEN 3 END) AS worst
  FROM feedback_topics t LEFT JOIN feedback_ai a ON a.topic_id = t.id LEFT JOIN open_issues o ON o.number = t.issue`
/** The most topics the By topic view lists. */
export const TOPICS_LISTED = 500
/** The topics, the one with the newest message first (spec 2026-10-10 §3.2). A topic with no message is listed only
 * once the coordinator has worked on it, after the others. */
export async function listTopics(db: D1Database): Promise<FeedbackTopicView[]> {
  const found = await db.prepare(`${TOPICS} GROUP BY t.id HAVING n > 0 OR t.updated_by IS NOT NULL ORDER BY newest IS NULL, newest DESC, t.id DESC LIMIT ?`).bind(TOPICS_LISTED).all<TopicRecord>()
  return found.results.map(topicView)
}
export async function getTopic(db: D1Database, id: number): Promise<FeedbackTopicView | null> {
  const r = await db.prepare(`${TOPICS} WHERE t.id = ? GROUP BY t.id`).bind(id).first<TopicRecord>()
  return r ? topicView(r) : null
}
/** The titles the model is given to choose from: of the topics whose messages are the newest, then of those with none. */
export async function topicTitles(db: D1Database, limit: number): Promise<FeedbackTopicRef[]> {
  const found = await db
    .prepare('SELECT t.id, t.title FROM feedback_topics t LEFT JOIN feedback_ai a ON a.topic_id = t.id GROUP BY t.id ORDER BY MAX(a.received_at) IS NULL, MAX(a.received_at) DESC, t.id DESC LIMIT ?')
    .bind(limit)
    .all<FeedbackTopicRef>()
  return found.results
}
/** As the database compares titles (COLLATE NOCASE): without regard to the case of A to Z. */
const sameTitle = (title: string) => title.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
/** Makes a topic for each title that no topic has yet, and gives each title's topic: a title that differs from an
 * existing one only in case is that topic. One batch and one read; at most a call's worth of titles. */
export async function insertTopicsIfAbsent(db: D1Database, titles: readonly string[], at: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (titles.length === 0) return out
  const insert = db.prepare('INSERT INTO feedback_topics (title, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT (title) DO NOTHING')
  await db.batch(titles.map((title) => insert.bind(title, at, at)))
  const found = await db.prepare(`SELECT id, title FROM feedback_topics WHERE title IN (${titles.map(() => '?').join(', ')})`).bind(...titles).all<FeedbackTopicRef>()
  const ids = new Map(found.results.map((r) => [sameTitle(r.title), r.id]))
  for (const title of titles) {
    const id = ids.get(sameTitle(title))
    if (id !== undefined) out.set(title, id)
  }
  return out
}
/** Sets a topic's title, state and note, all three each time. A title that changed marks the topic as renamed; a
 * title another topic has is refused, since two topics about one thing are to be merged. */
export async function putTopic(db: D1Database, id: number, t: { readonly title: string; readonly state: FeedbackState; readonly note: string }, by: string, at: string): Promise<'ok' | 'missing' | 'title-taken'> {
  if ((await db.prepare('SELECT id FROM feedback_topics WHERE title = ? AND id != ?').bind(t.title, id).first()) !== null) return 'title-taken'
  try {
    const set = await db
      .prepare('UPDATE feedback_topics SET renamed = CASE WHEN title = ? COLLATE BINARY THEN renamed ELSE 1 END, title = ?, state = ?, note = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .bind(t.title, t.title, t.state, t.note, at, by, id)
      .run()
    return set.meta.changes === 1 ? 'ok' : 'missing'
  } catch (err) {
    // Two renames at once to the same title: the second finds it taken.
    if (/UNIQUE constraint failed/i.test(err instanceof Error ? err.message : String(err))) return 'title-taken'
    throw err
  }
}
/**
 * Merges topic `from` into topic `into` (spec 2026-10-10 §3.2), in one batch: the messages go over, each keeping who
 * put it in its topic; the note is put under the target's own; the match goes over when the target has none; the
 * source is gone. The target keeps its title and its state.
 */
export async function mergeTopics(db: D1Database, from: number, into: number, by: string, at: string): Promise<'ok' | 'missing'> {
  if (from === into) return 'missing'
  const read = db.prepare('SELECT note, issue, issue_state FROM feedback_topics WHERE id = ?')
  type Kept = { note: string; issue: number | null; issue_state: TopicIssueState }
  const [source, target] = await Promise.all([read.bind(from).first<Kept>(), read.bind(into).first<Kept>()])
  if (!source || !target) return 'missing'
  const note = [target.note, source.note].filter((n) => n !== '').join('\n').slice(0, MAX_FEEDBACK_NOTE_LENGTH)
  const match = target.issue_state === 'none' ? source : target
  await db.batch([
    db.prepare('UPDATE feedback_ai SET topic_id = ? WHERE topic_id = ?').bind(into, from),
    db.prepare('UPDATE feedback_topics SET note = ?, issue = ?, issue_state = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(note, match.issue, match.issue_state, at, by, into),
    db.prepare('DELETE FROM feedback_topics WHERE id = ?').bind(from),
  ])
  return 'ok'
}
/** The coordinator puts a message in a topic: no later reading moves it again. Missing: the message has no reading, or there is no such topic. */
export async function moveFeedbackToTopic(db: D1Database, feedbackId: number, topic: number): Promise<'ok' | 'missing'> {
  const moved = await db.prepare("UPDATE feedback_ai SET topic_id = ?, topic_by = 'coordinator' WHERE feedback_id = ? AND EXISTS (SELECT 1 FROM feedback_topics WHERE id = ?)").bind(topic, feedbackId, topic).run()
  return moved.meta.changes === 1 ? 'ok' : 'missing'
}
/** The coordinator's answer on a topic's match: a number they confirmed or typed, or none and `removed`. False when there is no such topic. */
export async function setTopicIssue(db: D1Database, id: number, issue: number | null, state: TopicIssueState, by: string | null, at: string): Promise<boolean> {
  return (await db.prepare('UPDATE feedback_topics SET issue = ?, issue_state = ?, updated_at = ?, updated_by = COALESCE(?, updated_by) WHERE id = ?').bind(issue, state, at, by, id).run()).meta.changes === 1
}
/** The AI's proposals: each is kept only while its topic has no match at all, so never over one the coordinator
 * confirmed or removed, and never over an earlier proposal. A proposal is not the coordinator's work on a topic. */
export async function proposeTopicIssues(db: D1Database, proposals: readonly { readonly topic: number; readonly issue: number }[]): Promise<void> {
  if (proposals.length === 0) return
  const propose = db.prepare("UPDATE feedback_topics SET issue = ?, issue_state = 'proposed' WHERE id = ? AND issue_state = 'none'")
  await db.batch(proposals.map((p) => propose.bind(p.issue, p.topic)))
}
/** The ids of a topic's messages, the newest first, at most `limit` of them, and how many it has in all. */
export async function topicFeedbackIds(db: D1Database, topic: number, limit: number): Promise<{ ids: number[]; total: number }> {
  const found = await db.prepare('SELECT feedback_id, COUNT(*) OVER () AS total FROM feedback_ai WHERE topic_id = ? ORDER BY feedback_id DESC LIMIT ?').bind(topic, limit).all<{ feedback_id: number; total: number }>()
  return { ids: found.results.map((r) => r.feedback_id), total: found.results[0]?.total ?? 0 }
}
/** Marks every message of a topic done (spec 2026-10-10 §3.2): how many. A message keeps the note it has. */
export async function markTopicMessagesDone(db: D1Database, topic: number, by: string, at: string): Promise<number> {
  const marked = await db
    .prepare(
      `INSERT INTO feedback_marks (feedback_id, state, note, updated_at, updated_by) SELECT feedback_id, 'done', '', ?, ? FROM feedback_ai WHERE topic_id = ?
       ON CONFLICT (feedback_id) DO UPDATE SET state = 'done', updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(at, by, topic)
    .run()
  return marked.meta.changes
}

/** The open issues as last read, when that read is not older than `notOlderThan`: the newest issues first, at most `limit`. */
export async function openIssues(db: D1Database, notOlderThan: string, limit: number): Promise<{ number: number; title: string }[]> {
  return (await db.prepare('SELECT number, title FROM open_issues WHERE read_at >= ? ORDER BY number DESC LIMIT ?').bind(notOlderThan, limit).all<{ number: number; title: string }>()).results
}
/** Puts what a read gave in place of what was kept: one batch, so an issue that was closed is gone and a failed write keeps the old list. */
export async function replaceOpenIssues(db: D1Database, issues: readonly { readonly number: number; readonly title: string }[], at: string): Promise<void> {
  const insert = db.prepare('INSERT INTO open_issues (number, title, read_at) VALUES (?, ?, ?) ON CONFLICT (number) DO UPDATE SET title = excluded.title')
  await db.batch([db.prepare('DELETE FROM open_issues'), ...issues.map((issue) => insert.bind(issue.number, issue.title, at))])
}
/** Takes the UTC day for a read of the open issues: true when no read has it yet. Taken before anything is asked, and
 * never given back, so a read that fails is not tried again the same day. */
export async function claimIssuesRead(db: D1Database, now: Date): Promise<boolean> {
  return (await db.prepare('INSERT INTO open_issues_reads (day, at) VALUES (?, ?) ON CONFLICT (day) DO NOTHING').bind(utcDay(now), now.toISOString()).run()).meta.changes === 1
}
/** What came of the day's read, for whoever looks later. */
export async function settleIssuesRead(db: D1Database, now: Date, outcome: string): Promise<void> {
  await db.prepare('UPDATE open_issues_reads SET outcome = ? WHERE day = ?').bind(outcome, utcDay(now)).run()
}

/** A period of feedback as the readings count it (spec 2026-10-10 §3.4): numbers and topic titles, in one batch. */
export interface WeekCounts {
  readonly byCategory: readonly { readonly category: FeedbackCategory; readonly n: number; readonly blocks: number }[]
  readonly topTopics: readonly { readonly id: number; readonly title: string; readonly n: number }[]
  readonly blocking: readonly { readonly id: number | null; readonly title: string | null; readonly n: number }[]
  readonly newTopics: readonly FeedbackTopicRef[]
}
/**
 * Counts the readings of the messages received from `since` up to, and not at, `until` (epoch ms): by category, with
 * the bugs that block; the `top` topics with the most messages; the bugs that block by topic, a row with no id for
 * those in none; and the topics made in the period. At most `listed` rows of each of the last two.
 */
export async function weekCounts(db: D1Database, period: { readonly since: number; readonly until: number }, top: number, listed: number): Promise<WeekCounts> {
  const { since, until } = period
  const [byCategory, topTopics, blocking, newTopics] = (await db.batch([
    db.prepare("SELECT category, COUNT(*) AS n, COALESCE(SUM(category = 'bug' AND severity = 'blocks'), 0) AS blocks FROM feedback_ai WHERE received_at >= ? AND received_at < ? GROUP BY category").bind(since, until),
    db
      .prepare('SELECT t.id, t.title, COUNT(*) AS n FROM feedback_ai a JOIN feedback_topics t ON t.id = a.topic_id WHERE a.received_at >= ? AND a.received_at < ? GROUP BY t.id ORDER BY n DESC, MAX(a.received_at) DESC, t.id DESC LIMIT ?')
      .bind(since, until, top),
    db
      .prepare(
        `SELECT t.id, t.title, COUNT(*) AS n FROM feedback_ai a LEFT JOIN feedback_topics t ON t.id = a.topic_id
         WHERE a.received_at >= ? AND a.received_at < ? AND a.category = 'bug' AND a.severity = 'blocks' GROUP BY t.id ORDER BY n DESC, t.id IS NULL, t.id DESC LIMIT ?`,
      )
      .bind(since, until, listed),
    db.prepare('SELECT id, title FROM feedback_topics WHERE created_at >= ? AND created_at < ? ORDER BY id DESC LIMIT ?').bind(new Date(since).toISOString(), new Date(until).toISOString(), listed),
  ])) as [{ results: WeekCounts['byCategory'] }, { results: WeekCounts['topTopics'] }, { results: WeekCounts['blocking'] }, { results: WeekCounts['newTopics'] }]
  return { byCategory: byCategory.results, topTopics: topTopics.results, blocking: blocking.results, newTopics: newTopics.results }
}
/** The paragraph kept for a period (spec 2026-10-10 §3.4), or null. */
export async function weekText(db: D1Database, period: string): Promise<string | null> {
  return (await db.prepare('SELECT paragraph FROM feedback_week_texts WHERE period = ?').bind(period).first<{ paragraph: string }>())?.paragraph ?? null
}
/** Keeps a period's paragraph; the first one kept for a period stays. */
export async function putWeekText(db: D1Database, period: string, paragraph: string, at: string): Promise<void> {
  await db.prepare('INSERT INTO feedback_week_texts (period, paragraph, made_at) VALUES (?, ?, ?) ON CONFLICT (period) DO NOTHING').bind(period, paragraph, at).run()
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10)
/** Counts a call for the UTC day when the day is under its limit: true when it may be made. One statement, so two
 * requests at once cannot both pass the limit; counted before the call, so one that fails still counts. */
export async function claimAiCall(db: D1Database, now: Date, what: string, messages: number, limit: number): Promise<boolean> {
  const day = utcDay(now)
  const claimed = await db
    .prepare('INSERT INTO feedback_ai_calls (day, at, what, messages) SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM feedback_ai_calls WHERE day = ?) < ?')
    .bind(day, now.toISOString(), what, messages, day, limit)
    .run()
  return claimed.meta.changes === 1
}
export async function aiCallsToday(db: D1Database, now: Date): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM feedback_ai_calls WHERE day = ?').bind(utcDay(now)).first<{ n: number }>())?.n ?? 0
}

/** What an admin switched in the app itself, by name; null while nobody has. */
export async function getSetting(db: D1Database, name: string): Promise<string | null> {
  return (await db.prepare('SELECT value FROM settings WHERE name = ?').bind(name).first<{ value: string }>())?.value ?? null
}
export async function putSetting(db: D1Database, name: string, value: string, by: string, at: string): Promise<void> {
  await db
    .prepare('INSERT INTO settings (name, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
    .bind(name, value, at, by)
    .run()
}
