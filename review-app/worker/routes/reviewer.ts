import type { Hono } from 'hono'
import type { AssignmentView, RowsResponse } from '../../shared/hosted'
import { apiError, type AppEnv, type Deps } from '../app'
import { deleteDecisions, getAssignment, listAssignments, listDecisions, listReviewers, listSubmissions, type AssignmentRow } from '../db'
import { assignmentRows, progress, withDecisions } from '../rows'
import { currentSnapshot, type Snapshot } from '../snapshotStore'

export const NO_SNAPSHOT = 'The review data is not available yet.'

export async function assignmentView(deps: Deps, snap: Snapshot | null, a: AssignmentRow, names: ReadonlyMap<string, string>): Promise<AssignmentView> {
  const p = snap ? progress((await assignmentRows(snap, a)).rows, await listDecisions(deps.env.DB, a.id), await listSubmissions(deps.env.DB, { assignment: a.id })) : null
  return { id: a.id, reviewer: a.reviewer, reviewerName: names.get(a.reviewer) ?? a.reviewer, queue: a.queue, files: a.files, flaggedOnly: a.flaggedOnly, createdAt: a.createdAt, closedAt: a.closedAt, progress: p }
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
    return c.json(await Promise.all(list.map((a) => assignmentView(deps, snap, a, names))))
  })

  app.get('/api/rows', async (c) => {
    const a = await ownAssignment(deps, c.get('me').email, Number(c.req.query('assignment')))
    if (!a) return apiError(c, 403, 'not your assignment')
    const snap = await currentSnapshot(deps)
    if (!snap) return apiError(c, 503, NO_SNAPSHOT)
    const { rows, keys } = await assignmentRows(snap, a)
    const decisions = await listDecisions(deps.env.DB, a.id)
    const discarded = decisions.filter((d) => d.submission === null && !keys.has(d.key)).map((d) => d.key)
    await deleteDecisions(deps.env.DB, a.id, discarded)
    const body: RowsResponse = { rows: withDecisions(rows, decisions.filter((d) => !discarded.includes(d.key))), discarded }
    return c.json(body)
  })
}
