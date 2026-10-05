import type { D1Database } from './bindings'
import type { Language, ReviewerView, Role } from '../shared/hosted'

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
