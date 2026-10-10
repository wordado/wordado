import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AssignmentView, RowsResponse, SnapshotStatus, SplitProposal, SpotCheckCreated } from '../../shared/hosted'
import type { SnapshotIndex } from '../../shared/snapshot'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { getAssignment, insertReviewer, insertSubmission, markSubmitted } from '../db'
import { resetSnapshotCache } from '../snapshotStore'
import { testKeys } from '../test/jwt'
import { resetDb, startPlatform, testDeps } from '../test/platform'
import { putSnapshot } from '../test/snapshot'
import { NO_SNAPSHOT } from './reviewer'

let env: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
let index: SnapshotIndex
beforeAll(async () => {
  keys = await testKeys()
  const p = await startPlatform()
  env = { ...p.env, ACCESS_JWKS: keys.jwks }
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(async () => {
  await resetDb(env.DB)
  resetSnapshotCache()
  index = (await putSnapshot(env)).index
  await insertReviewer(env.DB, { email: 'ivan@example.com', name: 'Ivan', languages: ['bg', 'en'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
  await insertReviewer(env.DB, { email: 'eve@example.com', name: 'Eve', languages: ['bg'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
  await insertReviewer(env.DB, { email: 'hans@example.com', name: 'Hans', languages: ['de'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
})

const as = async (email: string, method: 'GET' | 'POST', path: string, body?: unknown) =>
  createApp(testDeps(env)).request(path, {
    method,
    headers: {
      'cf-access-jwt-assertion': await keys.token(email, env),
      ...(body !== undefined ? { origin: env.APP_ORIGIN, 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

// The admin reviewer is created on their first request (GET /api/me), as app.ts does for ADMIN_EMAIL.
const admin = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
  await as('admin@example.com', 'GET', '/api/me')
  return as('admin@example.com', method, path, body)
}

describe('admin assignments', () => {
  it('is 403 for a reviewer', async () => {
    expect((await as('ivan@example.com', 'GET', '/api/admin/assignments')).status).toBe(403)
  })

  it('creates an assignment in the reviewer’s language and refuses another language', async () => {
    const ok = await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })
    expect(ok.status).toBe(201)
    const created = (await ok.json()) as AssignmentView
    expect(created.reviewer).toBe('ivan@example.com')
    expect(created.reviewerName).toBe('Ivan')
    expect(created.flaggedOnly).toBe(true)
    expect(created.closedAt).toBeNull()
    const bad = await admin('POST', '/api/admin/assignments', { reviewer: 'hans@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })
    expect(bad.status).toBe(400)
  })

  it('refuses an overlapping assignment and names who has the file', async () => {
    const file = index.queues.find((q) => q.queue === 'translation-bg')!.files[0]!.file
    await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: [file], flaggedOnly: false })
    const res = await admin('POST', '/api/admin/assignments', { reviewer: 'eve@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { message: string }).message).toMatch(/Ivan/)
  })

  it('refuses files that are not in the snapshot', async () => {
    const res = await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: ['review/translation-bg/nope.csv'], flaggedOnly: false })
    expect(res.status).toBe(400)
  })

  it('is 503 creating an assignment while no snapshot exists at all (distinct from a queue with no open files)', async () => {
    await env.SNAPSHOTS.put('current.json', JSON.stringify({ id: 'missing', built: 't', commit: 'c' }))
    resetSnapshotCache()
    const res = await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toBe(NO_SNAPSHOT)
  })

  it('closes an assignment, which frees its files', async () => {
    const a = (await (await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })).json()) as AssignmentView
    const closed = await admin('POST', `/api/admin/assignments/${a.id}/close`, {})
    expect(closed.status).toBe(200)
    expect(((await closed.json()) as AssignmentView).closedAt).not.toBeNull()
    expect((await admin('POST', '/api/admin/assignments', { reviewer: 'eve@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })).status).toBe(201)
  })

  it('404s closing or reassigning an assignment that does not exist', async () => {
    expect((await admin('POST', '/api/admin/assignments/999/close', {})).status).toBe(404)
    expect((await admin('POST', '/api/admin/assignments/999/reassign', { to: 'eve@example.com', decisions: 'move' })).status).toBe(404)
  })

  it('lists open assignments first, then the newest closed ones', async () => {
    const a = (await (await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })).json()) as AssignmentView
    await admin('POST', `/api/admin/assignments/${a.id}/close`, {})
    const b = (await (await admin('POST', '/api/admin/assignments', { reviewer: 'eve@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })).json()) as AssignmentView
    const list = (await (await admin('GET', '/api/admin/assignments')).json()) as AssignmentView[]
    expect(list.map((x) => x.id)).toEqual([b.id, a.id])
    expect(list[0]!.closedAt).toBeNull()
    expect(list[1]!.closedAt).not.toBeNull()
  })

  it('reassigns, moving or discarding unsubmitted decisions', async () => {
    const a = (await (await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })).json()) as AssignmentView
    const row = ((await (await as('ivan@example.com', 'GET', `/api/rows?assignment=${a.id}`)).json()) as RowsResponse).rows[0]!
    await as('ivan@example.com', 'POST', '/api/decision', { assignment: a.id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'keep' })
    const moved = (await (await admin('POST', `/api/admin/assignments/${a.id}/reassign`, { to: 'eve@example.com', decisions: 'move' })).json()) as AssignmentView
    expect(moved.reviewer).toBe('eve@example.com')
    expect(moved.progress!.decided).toBe(1)
    const again = (await (await admin('POST', `/api/admin/assignments/${moved.id}/reassign`, { to: 'ivan@example.com', decisions: 'discard' })).json()) as AssignmentView
    expect(again.progress!.decided).toBe(0)
    expect((await admin('POST', `/api/admin/assignments/${again.id}/reassign`, { to: 'hans@example.com', decisions: 'move' })).status).toBe(400)
  })

  it('reassigns a closed assignment, carrying its unsubmitted decisions over (spec §5.1)', async () => {
    const a = (await (await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })).json()) as AssignmentView
    const row = ((await (await as('ivan@example.com', 'GET', `/api/rows?assignment=${a.id}`)).json()) as RowsResponse).rows[0]!
    await as('ivan@example.com', 'POST', '/api/decision', { assignment: a.id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'keep' })
    await admin('POST', `/api/admin/assignments/${a.id}/close`, {})
    const res = await admin('POST', `/api/admin/assignments/${a.id}/reassign`, { to: 'eve@example.com', decisions: 'move' })
    expect(res.status).toBe(200)
    const moved = (await res.json()) as AssignmentView
    expect(moved.reviewer).toBe('eve@example.com')
    expect(moved.closedAt).toBeNull()
    expect(moved.progress!.decided).toBe(1)
    const old = (await env.DB.prepare('SELECT closed_at FROM assignments WHERE id = ?').bind(a.id).first<{ closed_at: string }>())!
    expect(old.closed_at).not.toBeNull()
    // The files are now held by the new assignment, so a second reassignment of the closed one clashes.
    expect((await admin('POST', `/api/admin/assignments/${a.id}/reassign`, { to: 'ivan@example.com', decisions: 'move' })).status).toBe(409)
  })

  it('400s reassigning with a decisions value other than move or discard', async () => {
    const a = (await (await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })).json()) as AssignmentView
    expect((await admin('POST', `/api/admin/assignments/${a.id}/reassign`, { to: 'eve@example.com', decisions: 'zap' })).status).toBe(400)
  })

  // The shared fixture gives every queue exactly one file (level, title-bg, translation-bg all have one each), so a
  // real two-way split cannot be proposed from the fixture without adding files to it, which the task forbids.
  // proposeSplit's balancing logic is tested thoroughly in assign.test.ts instead; here we test what the fixture
  // allows: the 400 when there are fewer free files than reviewers, and the confirm path with a hand-built,
  // single-file proposal (confirm only replays the given proposal through createAssignment, so a one-entry
  // proposal still exercises the real route).
  it('400s a split proposal when the queue has fewer free files than reviewers', async () => {
    const res = await admin('POST', '/api/admin/assignments/split', { queue: 'translation-bg', flaggedOnly: false, reviewers: ['ivan@example.com', 'eve@example.com'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toMatch(/free files/)
  })

  it('creates assignments from a confirmed split proposal', async () => {
    const file = index.queues.find((q) => q.queue === 'translation-bg')!.files[0]!
    const proposal: SplitProposal[] = [{ reviewer: 'ivan@example.com', files: [file.file], rows: file.rows }]
    const done = await admin('POST', '/api/admin/assignments/split', {
      queue: 'translation-bg', flaggedOnly: false, reviewers: ['ivan@example.com'], confirm: true, proposal,
    })
    expect(done.status).toBe(201)
    const { assignments } = (await done.json()) as { assignments: AssignmentView[] }
    expect(assignments).toHaveLength(1)
    expect(assignments[0]!.reviewer).toBe('ivan@example.com')
    expect(assignments[0]!.files).toEqual([file.file])
  })

  it('rolls back assignments already created when a later entry in the confirmed proposal fails', async () => {
    const file = index.queues.find((q) => q.queue === 'translation-bg')!.files[0]!
    const proposal: SplitProposal[] = [
      { reviewer: 'ivan@example.com', files: [file.file], rows: file.rows },
      { reviewer: 'eve@example.com', files: ['review/translation-bg/nope.csv'], rows: 1 },
    ]
    const res = await admin('POST', '/api/admin/assignments/split', {
      queue: 'translation-bg', flaggedOnly: false, reviewers: ['ivan@example.com', 'eve@example.com'], confirm: true, proposal,
    })
    expect(res.status).toBe(400)
    const list = (await (await admin('GET', '/api/admin/assignments')).json()) as AssignmentView[]
    expect(list.filter((a) => a.closedAt === null)).toHaveLength(0)
    expect(list.find((a) => a.reviewer === 'ivan@example.com')!.closedAt).not.toBeNull()
  })

  it('reports the snapshot with who holds each file', async () => {
    await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'level', files: '*', flaggedOnly: true })
    const s = (await (await admin('GET', '/api/admin/snapshot')).json()) as SnapshotStatus
    expect(s.id).toBe(index.id)
    expect(s.queues.find((q) => q.queue === 'level')!.files.every((f) => f.assignedTo === 'Ivan')).toBe(true)
    expect(s.queues.find((q) => q.queue === 'title-bg')!.files.every((f) => f.assignedTo === null)).toBe(true)
  })

  it('reports no snapshot as null', async () => {
    await env.SNAPSHOTS.put('current.json', JSON.stringify({ id: 'missing', built: 't', commit: 'c' }))
    resetSnapshotCache()
    expect(await (await admin('GET', '/api/admin/snapshot')).json()).toBeNull()
  })
})

describe('spot checks', () => {
  const QUEUE = 'translation-bg'
  const spot = (over: Record<string, unknown> = {}) => admin('POST', '/api/admin/spot-checks', { reviewer: 'ivan@example.com', queue: QUEUE, rows: 10, seed: 7, ...over })
  const made = async (over: Record<string, unknown> = {}) => {
    const res = await spot(over)
    expect(res.status).toBe(201)
    return (await res.json()) as SpotCheckCreated
  }
  const rowsOf = async (id: number, email = 'ivan@example.com') => ((await (await as(email, 'GET', `/api/rows?assignment=${id}`)).json()) as RowsResponse).rows
  const message = async (res: Response) => ((await res.json()) as { message: string }).message

  it('draws the sample from the rows the AI review passed with no objection, unreported, and keeps it', async () => {
    const { assignment, asked, drawn } = await made()
    expect({ asked, drawn }).toEqual({ asked: 10, drawn: 10 })
    expect(assignment).toMatchObject({ reviewer: 'ivan@example.com', queue: QUEUE, flaggedOnly: false, spotCheck: { sample: 10, result: { checked: 0, fine: 0, minor: 0, serious: 0, seriousKeys: [] } } })
    expect(assignment.progress).toMatchObject({ inScope: 10, remaining: 10 })
    const stored = (await getAssignment(env.DB, assignment.id))!
    expect(stored.spotCheck!.seed).toBe(7)
    expect(stored.files).toEqual([...new Set(stored.spotCheck!.sample.map((s) => s.file))].sort())
    const rows = await rowsOf(assignment.id)
    // exactly the sample, in its stored order, on every load
    expect(rows.map((r) => r.key)).toEqual(stored.spotCheck!.sample.map((s) => s.key))
    expect((await rowsOf(assignment.id)).map((r) => r.key)).toEqual(rows.map((r) => r.key))
    expect(rows.every((r) => r.ai === 'passed' && r.objections.length === 0 && r.reports === '' && !r.stale)).toBe(true)
  })

  it('draws the same rows again for the same seed, and others for another', async () => {
    const first = await made()
    const keys = (await rowsOf(first.assignment.id)).map((r) => r.key)
    await admin('POST', `/api/admin/assignments/${first.assignment.id}/close`, {})
    const second = await made()
    expect((await rowsOf(second.assignment.id)).map((r) => r.key)).toEqual(keys)
    await admin('POST', `/api/admin/assignments/${second.assignment.id}/close`, {})
    const third = await made({ seed: 8 })
    expect((await rowsOf(third.assignment.id)).map((r) => r.key)).not.toEqual(keys)
  })

  it('takes no sample from a request: the assignment route ignores one, and stays an assignment of files', async () => {
    const f = index.queues.find((q) => q.queue === QUEUE)!.files[0]!.file
    const res = await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: QUEUE, files: [f], flaggedOnly: false, spotCheck: { seed: 1, sample: 5 } })
    expect(res.status).toBe(201)
    const view = (await res.json()) as { id: number; spotCheck: unknown }
    expect(view.spotCheck).toBeNull()
    expect((await getAssignment(env.DB, view.id))!.spotCheck).toBeNull()
    // and the lists still load
    expect((await admin('GET', '/api/admin/assignments')).status).toBe(200)
  })

  it('makes up a seed when none is given', async () => {
    const { assignment } = await made({ seed: undefined })
    expect(Number.isInteger((await getAssignment(env.DB, assignment.id))!.spotCheck!.seed)).toBe(true)
  })

  it('takes every eligible row and says how many when the queue has fewer than asked for', async () => {
    const { assignment, asked, drawn } = await made({ reviewer: 'ivan@example.com', queue: 'level', rows: 50 })
    const inLevel = index.queues.find((q) => q.queue === 'level')!.files.reduce((n, f) => n + f.rows, 0)
    expect({ asked, drawn }).toEqual({ asked: 50, drawn: inLevel })
    expect(assignment.spotCheck!.sample).toBe(inLevel)
  })

  it('leaves out a row that an open submission of another assignment has decided already', async () => {
    const all = await made({ rows: 500 })
    const taken = (await rowsOf(all.assignment.id))[0]!
    await as('ivan@example.com', 'POST', '/api/decision', { assignment: all.assignment.id, queue: QUEUE, file: taken.file, key: taken.key, rowHash: taken.rowHash, action: 'keep' })
    const sub = await insertSubmission(env.DB, { assignment: all.assignment.id, branch: 'b', pr: 1, url: null, count: 1, leftOut: 0, status: 'open', createdAt: 't' })
    await markSubmitted(env.DB, all.assignment.id, [taken.key], sub)
    await admin('POST', `/api/admin/assignments/${all.assignment.id}/close`, {})
    const next = await made({ rows: 500 })
    expect(next.drawn).toBe(all.drawn - 1)
    expect((await rowsOf(next.assignment.id)).map((r) => r.key)).not.toContain(taken.key)
  })

  it('refuses a reviewer without the language, a queue with nothing to draw, and a number of rows that is none', async () => {
    expect((await spot({ reviewer: 'hans@example.com' })).status).toBe(400)
    // the unit titles have no AI review: nothing passed it
    const none = await spot({ queue: 'title-bg' })
    expect(none.status).toBe(400)
    expect(await message(none)).toMatch(/no row that the AI review passed/)
    for (const rows of [0, -3, 2.5, '10', 501, undefined]) expect((await spot({ rows })).status).toBe(400)
    expect((await spot({ seed: 'x' })).status).toBe(400)
    expect((await as('ivan@example.com', 'POST', '/api/admin/spot-checks', { reviewer: 'ivan@example.com', queue: QUEUE, rows: 5 })).status).toBe(403)
  })

  it('stands beside a flagged-only assignment of the same files, made before or after it', async () => {
    expect((await admin('POST', '/api/admin/assignments', { reviewer: 'eve@example.com', queue: QUEUE, files: '*', flaggedOnly: true })).status).toBe(201)
    const { assignment } = await made()
    await admin('POST', `/api/admin/assignments/${assignment.id}/close`, {})
    await admin('POST', `/api/admin/assignments/${assignment.id - 1}/close`, {})
    await made()
    expect((await admin('POST', '/api/admin/assignments', { reviewer: 'eve@example.com', queue: QUEUE, files: '*', flaggedOnly: true })).status).toBe(201)
  })

  it('is refused beside an open assignment of every row of a file, and names who has it', async () => {
    const file = index.queues.find((q) => q.queue === QUEUE)!.files[0]!.file
    await admin('POST', '/api/admin/assignments', { reviewer: 'eve@example.com', queue: QUEUE, files: [file], flaggedOnly: false })
    const res = await spot()
    expect(res.status).toBe(409)
    expect(await message(res)).toMatch(/Eve is assigned every row/)
  })

  it('is refused beside another open spot check of the queue, and allowed once that one is closed', async () => {
    const { assignment } = await made()
    const res = await spot({ reviewer: 'eve@example.com' })
    expect(res.status).toBe(409)
    expect(await message(res)).toMatch(/already has an open spot check, with Ivan/)
    // another queue is no obstacle
    await made({ queue: 'level', rows: 2 })
    await admin('POST', `/api/admin/assignments/${assignment.id}/close`, {})
    await made({ reviewer: 'eve@example.com' })
  })

  it('refuses an assignment of every row over files an open spot check samples from, by file or by split', async () => {
    await made()
    const file = index.queues.find((q) => q.queue === QUEUE)!.files[0]!
    for (const files of ['*', [file.file]]) {
      const res = await admin('POST', '/api/admin/assignments', { reviewer: 'eve@example.com', queue: QUEUE, files, flaggedOnly: false })
      expect(res.status).toBe(409)
      expect(await message(res)).toMatch(/Ivan has a spot check/)
    }
    const split = await admin('POST', '/api/admin/assignments/split', { queue: QUEUE, flaggedOnly: false, reviewers: ['eve@example.com'], confirm: true, proposal: [{ reviewer: 'eve@example.com', files: [file.file], rows: file.rows }] })
    expect(split.status).toBe(409)
    // the flagged rows of the same file can still be dealt out
    const flagged = await admin('POST', '/api/admin/assignments/split', { queue: QUEUE, flaggedOnly: true, reviewers: ['eve@example.com'], confirm: true, proposal: [{ reviewer: 'eve@example.com', files: [file.file], rows: 3 }] })
    expect(flagged.status).toBe(201)
  })

  it('does not count as the holder of its files in the snapshot status', async () => {
    await made()
    const s = (await (await admin('GET', '/api/admin/snapshot')).json()) as SnapshotStatus
    expect(s.queues.find((q) => q.queue === QUEUE)!.files.every((f) => f.assignedTo === null)).toBe(true)
  })

  it('reassigns with the same sample in the same order, moving the decisions and what they were rated', async () => {
    const { assignment } = await made()
    const rows = await rowsOf(assignment.id)
    const first = rows[0]!
    await as('ivan@example.com', 'POST', '/api/decision', { assignment: assignment.id, queue: QUEUE, file: first.file, key: first.key, rowHash: first.rowHash, action: 'drop', severity: 'major' })
    const res = await admin('POST', `/api/admin/assignments/${assignment.id}/reassign`, { to: 'eve@example.com', decisions: 'move' })
    expect(res.status).toBe(200)
    const moved = (await res.json()) as AssignmentView
    expect(moved).toMatchObject({ reviewer: 'eve@example.com', closedAt: null, spotCheck: { sample: 10, result: { checked: 1, serious: 1, seriousKeys: [first.key] } } })
    const stored = (await getAssignment(env.DB, moved.id))!
    expect(stored.spotCheck).toEqual((await getAssignment(env.DB, assignment.id))!.spotCheck)
    const theirs = await rowsOf(moved.id, 'eve@example.com')
    expect(theirs.map((r) => r.key)).toEqual(rows.map((r) => r.key))
    expect(theirs[0]!.decision).toMatchObject({ action: 'drop', severity: 'major' })
    expect((await as('ivan@example.com', 'GET', `/api/rows?assignment=${moved.id}`)).status).toBe(403)
  })

  it('shows the result in the admin list: checked, fine, minor, serious and the serious rows, submitted or not', async () => {
    const { assignment } = await made()
    const [a, b, c, d] = await rowsOf(assignment.id)
    const decide = (r: RowsResponse['rows'][number], body: Record<string, unknown>) =>
      as('ivan@example.com', 'POST', '/api/decision', { assignment: assignment.id, queue: QUEUE, file: r.file, key: r.key, rowHash: r.rowHash, ...body })
    expect((await decide(a!, { action: 'keep' })).status).toBe(200)
    expect((await decide(b!, { action: 'edit', cells: { translation: 'x' }, severity: 'minor' })).status).toBe(200)
    expect((await decide(c!, { action: 'drop', severity: 'major' })).status).toBe(200)
    expect((await decide(d!, { action: 'keep' })).status).toBe(200)
    const sub = await insertSubmission(env.DB, { assignment: assignment.id, branch: 'b', pr: 1, url: null, count: 1, leftOut: 0, status: 'open', createdAt: 't' })
    await markSubmitted(env.DB, assignment.id, [c!.key, d!.key], sub)
    const list = (await (await admin('GET', '/api/admin/assignments')).json()) as AssignmentView[]
    expect(list.find((x) => x.id === assignment.id)!.spotCheck).toEqual({ sample: 10, result: { checked: 4, fine: 2, minor: 1, serious: 1, seriousKeys: [c!.key] } })
    // the reviewer's own list carries it too, for the label
    const mine = (await (await as('ivan@example.com', 'GET', '/api/assignments')).json()) as AssignmentView[]
    expect(mine[0]!.spotCheck!.sample).toBe(10)
    expect(mine[0]!.progress).toMatchObject({ inScope: 10, decided: 2, submitted: 2, remaining: 6 })
  })
})

