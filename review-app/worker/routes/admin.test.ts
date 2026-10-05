import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AssignmentView, RowsResponse, SnapshotStatus, SplitProposal } from '../../shared/hosted'
import type { SnapshotIndex } from '../../shared/snapshot'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { insertReviewer } from '../db'
import { resetSnapshotCache } from '../snapshotStore'
import { testKeys } from '../test/jwt'
import { resetDb, startPlatform, testDeps } from '../test/platform'
import { putSnapshot } from '../test/snapshot'

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
