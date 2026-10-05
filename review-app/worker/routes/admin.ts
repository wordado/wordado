import type { Hono } from 'hono'
import { languageOf, type SnapshotStatus, type SplitProposal } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { filesOverlap, proposeSplit, SplitError } from '../assign'
import { closeAssignment, deleteDecisions, getAssignment, getReviewer, insertAssignment, listAssignments, listDecisions, moveDecisions, type AssignmentRow } from '../db'
import { currentSnapshot } from '../snapshotStore'
import { assignmentView, NO_SNAPSHOT, reviewerNames } from './reviewer'

type Created = { id: number } | { status: 400 | 409 | 503; message: string }

/** Shared by create, reassign and split (spec §5): validates the reviewer's language, the files against the
 * snapshot, and that no other open assignment already covers any of them. `ignore` lets reassign and split leave
 * the assignment being replaced out of the overlap check. */
export async function createAssignment(
  deps: Deps,
  input: { reviewer: string; queue: string; files: readonly string[] | '*'; flaggedOnly: boolean },
  ignore?: number,
): Promise<Created> {
  const r = await getReviewer(deps.env.DB, String(input.reviewer))
  if (!r || r.disabledAt) return { status: 400, message: `${String(input.reviewer)} is not an active reviewer` }
  const lang = languageOf(String(input.queue))
  if (!lang || !r.languages.includes(lang)) return { status: 400, message: `${r.name} does not review ${String(input.queue)}` }
  const snap = await currentSnapshot(deps)
  if (!snap) return { status: 503, message: NO_SNAPSHOT }
  const q = snap.queue(input.queue)
  if (!q) return { status: 400, message: `${input.queue} has no open review files` }
  const files = input.files === '*' ? '*' : Array.isArray(input.files) ? input.files.map(String) : null
  if (files === null || (files !== '*' && files.length === 0)) return { status: 400, message: 'pick files, or all files' }
  const known = new Set(q.files.map((f) => f.file))
  const unknown = files === '*' ? undefined : files.find((f) => !known.has(f))
  if (unknown) return { status: 400, message: `${unknown} is not an open file of ${input.queue}` }
  const names = await reviewerNames(deps)
  const clash = (await listAssignments(deps.env.DB, { queue: input.queue, open: true })).find((a) => a.id !== ignore && filesOverlap(a.files, files))
  if (clash) return { status: 409, message: `${clash.files === '*' ? 'This queue' : 'A file'} is already assigned to ${names.get(clash.reviewer) ?? clash.reviewer}` }
  return { id: await insertAssignment(deps.env.DB, { reviewer: r.email, queue: input.queue, files, flaggedOnly: Boolean(input.flaggedOnly), createdAt: deps.now().toISOString() }) }
}

/** Closes the reviewer's open assignments that match (Task 8: disabling, removing a language). */
export async function closeAssignmentsWhere(deps: Deps, email: string, pred: (a: AssignmentRow) => boolean): Promise<void> {
  for (const a of await listAssignments(deps.env.DB, { reviewer: email, open: true })) if (pred(a)) await closeAssignment(deps.env.DB, a.id, deps.now().toISOString())
}

export function adminRoutes(app: Hono<AppEnv>, deps: Deps): void {
  app.use('/api/admin/*', async (c, next) => (c.get('me').role === 'admin' ? next() : apiError(c, 403, 'admins only')))

  const view = async (id: number) => assignmentView(deps, await currentSnapshot(deps), (await getAssignment(deps.env.DB, id))!, await reviewerNames(deps))

  app.get('/api/admin/assignments', async (c) => {
    const snap = await currentSnapshot(deps)
    const names = await reviewerNames(deps)
    const all = await listAssignments(deps.env.DB)
    const shown = [...all.filter((a) => a.closedAt === null), ...all.filter((a) => a.closedAt !== null).slice(0, 50)]
    return c.json(await Promise.all(shown.map((a) => assignmentView(deps, snap, a, names))))
  })

  app.post('/api/admin/assignments', async (c) => {
    const body = await jsonBody<{ reviewer: string; queue: string; files: string[] | '*'; flaggedOnly: boolean }>(c)
    const made = await createAssignment(deps, body)
    if ('status' in made) return apiError(c, made.status, made.message)
    return c.json(await view(made.id), 201)
  })

  app.post('/api/admin/assignments/:id/close', async (c) => {
    const a = await getAssignment(deps.env.DB, Number(c.req.param('id')))
    if (!a) return apiError(c, 404, 'no such assignment')
    await closeAssignment(deps.env.DB, a.id, deps.now().toISOString())
    return c.json(await view(a.id))
  })

  app.post('/api/admin/assignments/:id/reassign', async (c) => {
    const body = await jsonBody<{ to?: unknown; decisions?: unknown }>(c)
    const a = await getAssignment(deps.env.DB, Number(c.req.param('id')))
    if (!a || a.closedAt !== null) return apiError(c, 404, 'no such open assignment')
    if (body.decisions !== 'move' && body.decisions !== 'discard') return apiError(c, 400, 'decisions must be move or discard')
    const made = await createAssignment(deps, { reviewer: String(body.to), queue: a.queue, files: a.files, flaggedOnly: a.flaggedOnly }, a.id)
    if ('status' in made) return apiError(c, made.status, made.message)
    await closeAssignment(deps.env.DB, a.id, deps.now().toISOString())
    if (body.decisions === 'move') await moveDecisions(deps.env.DB, a.id, made.id)
    else await deleteDecisions(deps.env.DB, a.id, (await listDecisions(deps.env.DB, a.id)).filter((d) => d.submission === null).map((d) => d.key))
    return c.json(await view(made.id))
  })

  app.post('/api/admin/assignments/split', async (c) => {
    const body = await jsonBody<{ queue: string; flaggedOnly: boolean; reviewers: string[]; confirm?: boolean; proposal?: SplitProposal[] }>(c)
    const snap = await currentSnapshot(deps)
    if (!snap) return apiError(c, 503, NO_SNAPSHOT)
    const q = snap.queue(String(body.queue))
    if (!q) return apiError(c, 400, `${String(body.queue)} has no open review files`)
    if (body.confirm === true) {
      if (!Array.isArray(body.proposal)) return apiError(c, 400, 'confirm needs the proposal')
      const made: number[] = []
      for (const p of body.proposal) {
        const r = await createAssignment(deps, { reviewer: p.reviewer, queue: q.queue, files: p.files, flaggedOnly: Boolean(body.flaggedOnly) })
        if ('status' in r) {
          for (const id of made) await closeAssignment(deps.env.DB, id, deps.now().toISOString())
          return apiError(c, r.status, r.message)
        }
        made.push(r.id)
      }
      return c.json({ assignments: await Promise.all(made.map(view)) }, 201)
    }
    const taken = (await listAssignments(deps.env.DB, { queue: q.queue, open: true })).flatMap((a) => (a.files === '*' ? q.files.map((f) => f.file) : a.files))
    const free = q.files
      .filter((f) => !taken.includes(f.file))
      .map((f) => ({ file: f.file, weight: body.flaggedOnly ? f.flagged + f.reported : f.rows }))
      .filter((f) => !body.flaggedOnly || f.weight > 0)
    try {
      return c.json({ proposal: proposeSplit(free, Array.isArray(body.reviewers) ? body.reviewers.map(String) : []) })
    } catch (err) {
      if (err instanceof SplitError) return apiError(c, 400, err.message)
      throw err
    }
  })

  app.get('/api/admin/snapshot', async (c) => {
    const snap = await currentSnapshot(deps)
    if (!snap) return c.json(null)
    const names = await reviewerNames(deps)
    const open = await listAssignments(deps.env.DB, { open: true })
    const holder = (queue: string, file: string) => {
      const a = open.find((x) => x.queue === queue && (x.files === '*' || x.files.includes(file)))
      return a ? (names.get(a.reviewer) ?? a.reviewer) : null
    }
    const body: SnapshotStatus = {
      id: snap.index.id, built: snap.index.built, commit: snap.index.commit,
      queues: snap.index.queues.map((q) => ({ queue: q.queue, language: q.language, files: q.files.map((f) => ({ ...f, assignedTo: holder(q.queue, f.file) })) })),
    }
    return c.json(body)
  })
}
