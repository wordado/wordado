import type { Hono } from 'hono'
import type { AssignmentView, RowsResponse } from '../../shared/hosted'
import { apiError, type AppEnv, type Deps } from '../app'
import { deleteDecisions, freezeProgress, getAssignment, listAssignments, listDecisions, listDecisionsOf, listReviewers, listSubmissions, listSubmissionsOf, type AssignmentRow, type DecisionRow, type FrozenProgress, type SubmissionRow } from '../db'
import { assignmentHashes, assignmentRows, progress, withDecisions } from '../rows'
import { currentSnapshot, type Snapshot } from '../snapshotStore'
import { spotCheckResult } from '../spotCheck'

export const NO_SNAPSHOT = 'The review data is not available yet.'

/** An assignment's figures counted from the snapshot, or null when it cannot be counted (rows unavailable). */
async function countFigures(snap: Snapshot, a: AssignmentRow, decisions: () => Promise<DecisionRow[]>, submissions: () => Promise<SubmissionRow[]>): Promise<FrozenProgress | null> {
  const rows = await assignmentHashes(snap, a)
  if (!rows) return null
  const decided = await decisions()
  return { progress: progress(rows, decided, await submissions()), spotCheck: a.spotCheck ? spotCheckResult(a.spotCheck.sample, rows, decided) : null }
}

/**
 * The assignments as the lists show them. An open one is counted against the current snapshot. A closed one shows
 * the figures kept when it was closed (#281), reading nothing for them; one closed without them (before they were
 * kept, or while no snapshot was there) is counted here and they are kept, with one read of the decisions, one of
 * the submissions and one write for all such assignments together, so that a list stays within the plan's statements.
 */
export async function assignmentViews(deps: Deps, snap: Snapshot | null, list: readonly AssignmentRow[], names: ReadonlyMap<string, string>): Promise<AssignmentView[]> {
  const db = deps.env.DB
  const frozen = new Map(list.flatMap((a) => (a.frozen ? [[a.id, a.frozen] as const] : [])))
  const unfrozen = snap ? list.filter((a) => a.closedAt !== null && a.frozen === null) : []
  if (snap && unfrozen.length > 0) {
    const ids = unfrozen.map((a) => a.id)
    const [decisions, submissions] = await Promise.all([listDecisionsOf(db, ids), listSubmissionsOf(db, ids)])
    const counted = new Map<number, FrozenProgress>()
    for (const a of unfrozen) {
      const f = await countFigures(snap, a, async () => decisions.filter((d) => d.assignment === a.id), async () => submissions.filter((s) => s.assignment === a.id))
      if (f) counted.set(a.id, f)
    }
    await freezeProgress(db, counted)
    for (const [id, f] of counted) frozen.set(id, f)
  }
  const figures = async (a: AssignmentRow) =>
    a.closedAt !== null ? (frozen.get(a.id) ?? null) : snap ? countFigures(snap, a, () => listDecisions(db, a.id), () => listSubmissions(db, { assignment: a.id })) : null
  return Promise.all(
    list.map(async (a) => {
      const f = await figures(a)
      const spotCheck = a.spotCheck ? { sample: a.spotCheck.sample.length, result: f?.spotCheck ?? null } : null
      return { id: a.id, reviewer: a.reviewer, reviewerName: names.get(a.reviewer) ?? a.reviewer, queue: a.queue, files: a.files, flaggedOnly: a.flaggedOnly, spotCheck, createdAt: a.createdAt, closedAt: a.closedAt, progress: f?.progress ?? null }
    }),
  )
}

export async function assignmentView(deps: Deps, snap: Snapshot | null, a: AssignmentRow, names: ReadonlyMap<string, string>): Promise<AssignmentView> {
  return (await assignmentViews(deps, snap, [a], names))[0]!
}

export async function reviewerNames(deps: Deps): Promise<Map<string, string>> {
  return new Map((await listReviewers(deps.env.DB)).map((r) => [r.email, r.name]))
}

/** The signed-in reviewer's open assignment, or null (403). */
export async function ownAssignment(deps: Deps, email: string, id: number): Promise<AssignmentRow | null> {
  const a = Number.isInteger(id) ? await getAssignment(deps.env.DB, id) : null
  return a && a.reviewer === email && a.closedAt === null ? a : null
}

export function reviewerRoutes(app: Hono<AppEnv>, deps: Deps): void {
  app.get('/api/assignments', async (c) => {
    const me = c.get('me')
    const snap = await currentSnapshot(deps)
    const names = await reviewerNames(deps)
    const list = await listAssignments(deps.env.DB, { reviewer: me.email, open: true })
    return c.json(await assignmentViews(deps, snap, list, names))
  })

  app.get('/api/rows', async (c) => {
    const a = await ownAssignment(deps, c.get('me').email, Number(c.req.query('assignment')))
    if (!a) return apiError(c, 403, 'not your assignment')
    const snap = await currentSnapshot(deps)
    if (!snap) return apiError(c, 503, NO_SNAPSHOT)
    const scoped = await assignmentRows(snap, a)
    if (!scoped) return apiError(c, 503, NO_SNAPSHOT)
    const { rows, keys } = scoped
    const decisions = await listDecisions(deps.env.DB, a.id)
    const discarded = decisions.filter((d) => d.submission === null && !keys.has(d.key)).map((d) => d.key)
    await deleteDecisions(deps.env.DB, a.id, discarded)
    const body: RowsResponse = { rows: withDecisions(rows, decisions.filter((d) => !discarded.includes(d.key))), discarded }
    return c.json(body)
  })
}
