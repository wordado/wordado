import type { Hono } from 'hono'
import { languageOf, type SnapshotStatus, type SplitProposal, type SpotCheckCreated } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import type { RowView } from '../../server/types'
import type { SnapshotQueue } from '../../shared/snapshot'
import { clashes, proposeSplit, SplitError, type Coverage } from '../assign'
import { closeAssignment, deleteDecisions, getAssignment, getReviewer, insertAssignment, listAssignments, listDecisions, moveDecisions, settledRows, type AssignmentRow, type ReviewerRow, type SpotCheck } from '../db'
import { currentSnapshot, type Snapshot } from '../snapshotStore'
import { drawSample } from '../spotCheck'
import { assignmentView, NO_SNAPSHOT, reviewerNames } from './reviewer'

type Refused = { status: 400 | 409 | 503; message: string }
type Created = { id: number } | Refused

/** The largest sample a spot check may ask for. */
export const SPOT_CHECK_MAX = 500

/** The reviewer and the queue's part of the snapshot, or why the reviewer cannot be given work in the queue. */
async function reviewerAndQueue(deps: Deps, reviewer: unknown, queue: unknown): Promise<{ r: ReviewerRow; snap: Snapshot; q: SnapshotQueue } | Refused> {
  const r = await getReviewer(deps.env.DB, String(reviewer))
  if (!r || r.disabledAt) return { status: 400, message: `${String(reviewer)} is not an active reviewer` }
  const lang = languageOf(String(queue))
  if (!lang || !r.languages.includes(lang)) return { status: 400, message: `${r.name} does not review ${String(queue)}` }
  const snap = await currentSnapshot(deps)
  if (!snap) return { status: 503, message: NO_SNAPSHOT }
  const q = snap.queue(String(queue))
  if (!q) return { status: 400, message: `${String(queue)} has no open review files` }
  return { r, snap, q }
}

/** The open assignment of the queue that a new one with this coverage cannot stand beside (spec §5, §15), in words; null when there is none. */
async function clashOf(deps: Deps, queue: string, wanted: Coverage, ignore?: number): Promise<string | null> {
  const clash = (await listAssignments(deps.env.DB, { queue, open: true })).find((a) => a.id !== ignore && clashes({ files: a.files, flaggedOnly: a.flaggedOnly, spotCheck: a.spotCheck !== null }, wanted))
  if (!clash) return null
  const who = (await reviewerNames(deps)).get(clash.reviewer) ?? clash.reviewer
  if (clash.spotCheck && wanted.spotCheck) return `This queue already has an open spot check, with ${who}`
  if (clash.spotCheck) return `${who} has a spot check on rows of ${clash.files === '*' || wanted.files === '*' ? 'this queue' : 'these files'}: assign the flagged rows only, or close the spot check first`
  if (wanted.spotCheck) return `${who} is assigned every row of ${clash.files === '*' ? 'this queue' : 'a file of this queue'}: a spot check cannot run beside that`
  return `${clash.files === '*' ? 'This queue' : 'A file'} is already assigned to ${who}`
}

/** Shared by create, reassign and split (spec §5): validates the reviewer's language, the files against the
 * snapshot, and that no other open assignment already covers any of them. `ignore` lets reassign and split leave
 * the assignment being replaced out of the overlap check. A `spotCheck` is one being reassigned: its sample goes
 * to the new assignment as it is, and a file of it that has left the snapshot is no obstacle (its rows drop out). */
export async function createAssignment(
  deps: Deps,
  input: { reviewer: string; queue: string; files: readonly string[] | '*'; flaggedOnly: boolean; spotCheck?: SpotCheck | null },
  ignore?: number,
): Promise<Created> {
  const found = await reviewerAndQueue(deps, input.reviewer, input.queue)
  if ('status' in found) return found
  const { r, q } = found
  const spotCheck = input.spotCheck ?? null
  const files = input.files === '*' ? '*' : Array.isArray(input.files) ? input.files.map(String) : null
  if (files === null || (files !== '*' && files.length === 0 && !spotCheck)) return { status: 400, message: 'pick files, or all files' }
  const known = new Set(q.files.map((f) => f.file))
  const unknown = files === '*' || spotCheck ? undefined : files.find((f) => !known.has(f))
  if (unknown) return { status: 400, message: `${unknown} is not an open file of ${input.queue}` }
  const flaggedOnly = spotCheck ? false : Boolean(input.flaggedOnly)
  const clash = await clashOf(deps, q.queue, { files, flaggedOnly, spotCheck: spotCheck !== null }, ignore)
  if (clash) return { status: 409, message: clash }
  return { id: await insertAssignment(deps.env.DB, { reviewer: r.email, queue: q.queue, files, flaggedOnly, spotCheck, createdAt: deps.now().toISOString() }) }
}

/**
 * Makes a spot check (spec §15): draws up to `rows` rows of the queue that the AI review passed with no objection,
 * that no learner reported, that are not stale and that no open or merged submission has decided already, spread
 * evenly over the levels. The seed is kept with the sample, so the draw can be made again and explained.
 */
export async function createSpotCheck(deps: Deps, input: { reviewer: unknown; queue: unknown; rows: unknown; seed?: unknown }): Promise<{ id: number; asked: number; drawn: number } | Refused> {
  const found = await reviewerAndQueue(deps, input.reviewer, input.queue)
  if ('status' in found) return found
  const { r, snap, q } = found
  const asked = input.rows
  if (typeof asked !== 'number' || !Number.isInteger(asked) || asked < 1 || asked > SPOT_CHECK_MAX) return { status: 400, message: `a spot check takes between 1 and ${SPOT_CHECK_MAX} rows` }
  if (input.seed !== undefined && (typeof input.seed !== 'number' || !Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff)) return { status: 400, message: 'the seed must be a whole number' }
  // Before the draw it may take rows from any file of the queue.
  const clash = await clashOf(deps, q.queue, { files: '*', flaggedOnly: false, spotCheck: true })
  if (clash) return { status: 409, message: clash }
  const all: RowView[] = []
  for (const f of q.files) {
    const file = await snap.file(f.file)
    if (!file) return { status: 503, message: NO_SNAPSHOT }
    all.push(...file.rows)
  }
  const settled = await settledRows(deps.env.DB, q.queue)
  const seed = input.seed ?? crypto.getRandomValues(new Uint32Array(1))[0]!
  const sample = drawSample(all, asked, seed, (row) => settled.get(row.key)?.has(row.rowHash) === true)
  if (sample.length === 0) return { status: 400, message: `${q.queue} has no row that the AI review passed without an objection` }
  const files = [...new Set(sample.map((s) => s.file))].sort()
  const id = await insertAssignment(deps.env.DB, { reviewer: r.email, queue: q.queue, files, flaggedOnly: false, spotCheck: { seed, sample }, createdAt: deps.now().toISOString() })
  return { id, asked, drawn: sample.length }
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

  app.post('/api/admin/spot-checks', async (c) => {
    const body = await jsonBody<{ reviewer?: unknown; queue?: unknown; rows?: unknown; seed?: unknown }>(c)
    const made = await createSpotCheck(deps, { reviewer: body.reviewer, queue: body.queue, rows: body.rows, seed: body.seed })
    if ('status' in made) return apiError(c, made.status, made.message)
    return c.json({ assignment: await view(made.id), asked: made.asked, drawn: made.drawn } satisfies SpotCheckCreated, 201)
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
    // A closed assignment can be reassigned too (spec §5.1): closing, disabling a reviewer and removing a
    // language keep its unsubmitted decisions so that a later reassignment can take them over.
    if (!a) return apiError(c, 404, 'no such assignment')
    if (body.decisions !== 'move' && body.decisions !== 'discard') return apiError(c, 400, 'decisions must be move or discard')
    const made = await createAssignment(deps, { reviewer: String(body.to), queue: a.queue, files: a.files, flaggedOnly: a.flaggedOnly, spotCheck: a.spotCheck }, a.id)
    if ('status' in made) return apiError(c, made.status, made.message)
    if (a.closedAt === null) await closeAssignment(deps.env.DB, a.id, deps.now().toISOString())
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
    // A spot check is never part of a split, and holds its files only against an all-rows assignment (spec §15).
    const taken = (await listAssignments(deps.env.DB, { queue: q.queue, open: true }))
      .filter((a) => a.spotCheck === null || !body.flaggedOnly)
      .flatMap((a) => (a.files === '*' ? q.files.map((f) => f.file) : a.files))
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
      // Who has the file's rows to decide; a spot check has a sample of them only, and is told apart on its own row.
      const a = open.find((x) => x.queue === queue && x.spotCheck === null && (x.files === '*' || x.files.includes(file)))
      return a ? (names.get(a.reviewer) ?? a.reviewer) : null
    }
    const body: SnapshotStatus = {
      id: snap.index.id, built: snap.index.built, commit: snap.index.commit,
      queues: snap.index.queues.map((q) => ({ queue: q.queue, language: q.language, files: q.files.map((f) => ({ ...f, assignedTo: holder(q.queue, f.file) })) })),
    }
    return c.json(body)
  })
}
