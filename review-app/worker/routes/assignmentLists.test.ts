import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AssignmentView } from '../../shared/hosted'
import { snapshotDigestKey, snapshotFileKey, type QueueDigest, type SnapshotFile, type SnapshotIndex } from '../../shared/snapshot'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { closeAssignment, insertAssignment, listAssignments, insertReviewer, insertSubmission, upsertDecision } from '../db'
import { resetSnapshotCache } from '../snapshotStore'
import { testKeys } from '../test/jwt'
import { resetDb, startPlatform, testDeps } from '../test/platform'
import { countedSnapshots, putSnapshot } from '../test/snapshot'

/**
 * The lists of assignments (My work, Admin → Assignments) count each assignment's progress from the snapshot's
 * digests, not its files: parsing every file of every assignment listed took the Worker over its CPU limit (#279).
 */
let base: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
let index: SnapshotIndex
let out: string
let counted: ReturnType<typeof countedSnapshots>
beforeAll(async () => {
  keys = await testKeys()
  const p = await startPlatform()
  base = { ...p.env, ACCESS_JWKS: keys.jwks }
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(async () => {
  await resetDb(base.DB)
  resetSnapshotCache()
  ;({ index, out } = await putSnapshot(base))
  counted = countedSnapshots(base.SNAPSHOTS)
  await insertReviewer(base.DB, { email: 'ivan@example.com', name: 'Ivan', languages: ['bg', 'en'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
  await assignments()
})

const get = async (path: string, email = 'ivan@example.com') =>
  createApp(testDeps({ ...base, SNAPSHOTS: counted.bucket })).request(path, { headers: { 'cf-access-jwt-assertion': await keys.token(email, base) } })
const list = async (path: string, email?: string) => (await (await get(path, email)).json()) as AssignmentView[]
const rowsOf = (file: string) => (JSON.parse(readFileSync(join(out, snapshotFileKey(index.id, file)), 'utf8')) as SnapshotFile).rows

/** A whole-file, two flagged-only, a closed whole-queue and a spot-check assignment, with decisions of every kind. */
async function assignments(): Promise<void> {
  const first = index.queues.find((q) => q.queue === 'translation-bg')!.files[0]!.file
  const rows = rowsOf(first)
  const at = { queue: 'translation-bg', file: first, action: 'keep' as const, cells: {}, note: '', decidedAt: 't', submission: null }
  const whole = await insertAssignment(base.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: [first], flaggedOnly: false, createdAt: 't' })
  const open = await insertSubmission(base.DB, { assignment: whole, branch: 'b', pr: 1, url: null, count: 1, leftOut: 0, status: 'open', createdAt: 't' })
  await upsertDecision(base.DB, { ...at, assignment: whole, key: rows[0]!.key, rowHash: rows[0]!.rowHash })
  await upsertDecision(base.DB, { ...at, assignment: whole, key: rows[1]!.key, rowHash: 'changed since' })
  await upsertDecision(base.DB, { ...at, assignment: whole, key: rows[2]!.key, rowHash: rows[2]!.rowHash, submission: open })
  await upsertDecision(base.DB, { ...at, assignment: whole, key: 'gone-1', rowHash: 'x' })
  for (const queue of ['translation-bg', 'level']) await insertAssignment(base.DB, { reviewer: 'ivan@example.com', queue, files: '*', flaggedOnly: true, createdAt: 't' })
  const closed = await insertAssignment(base.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: false, createdAt: 't' })
  await closeAssignment(base.DB, closed, 't')
  const sample = [...rows.slice(0, 5).map((r) => ({ file: r.file, key: r.key })), { file: first, key: 'gone-2' }]
  const spot = await insertAssignment(base.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: [first], flaggedOnly: false, createdAt: 't', spotCheck: { seed: 1, sample } })
  const merged = await insertSubmission(base.DB, { assignment: spot, branch: 'c', pr: 2, url: null, count: 1, leftOut: 0, status: 'merged', createdAt: 't' })
  await upsertDecision(base.DB, { ...at, assignment: spot, key: rows[0]!.key, rowHash: rows[0]!.rowHash, action: 'edit', severity: 'major' })
  await upsertDecision(base.DB, { ...at, assignment: spot, key: rows[1]!.key, rowHash: rows[1]!.rowHash, action: 'edit', severity: 'minor' })
  await upsertDecision(base.DB, { ...at, assignment: spot, key: 'gone-2', rowHash: 'x', action: 'drop', severity: 'major', submission: merged })
}

const fileKeys = () => new Set(index.queues.flatMap((q) => q.files.map((f) => snapshotFileKey(index.id, f.file))))
const digestKeys = () => new Set(index.queues.map((q) => snapshotDigestKey(index.id, q.queue)))

describe('the lists of assignments', () => {
  it('read no snapshot file, and at most one digest per queue', async () => {
    for (const [path, email] of [['/api/assignments', 'ivan@example.com'], ['/api/admin/assignments', 'admin@example.com']] as const) {
      await get('/api/me', email)
      resetSnapshotCache()
      counted.gets.length = 0
      const shown = await list(path, email)
      expect(shown.length).toBeGreaterThanOrEqual(3)
      expect(shown.every((a) => a.progress !== null)).toBe(true)
      expect(counted.gets.filter((k) => fileKeys().has(k))).toEqual([])
      const digests = counted.gets.filter((k) => digestKeys().has(k))
      expect(digests.length).toBe(new Set(digests).size)
      expect(counted.gets.filter((k) => !digestKeys().has(k)).sort()).toEqual(['current.json', `snapshots/${index.id}/index.json`])
    }
  })

  it('count the same progress and spot-check result from the files when the snapshot has no digests', async () => {
    await get('/api/me', 'admin@example.com')
    const fromDigests = { mine: await list('/api/assignments'), all: await list('/api/admin/assignments', 'admin@example.com') }
    const whole = fromDigests.mine.find((a) => a.files !== '*' && a.spotCheck === null)!
    expect(whole.progress).toMatchObject({ decided: 1, changed: 1, submitted: 1 })
    expect(fromDigests.mine.find((a) => a.spotCheck !== null)!.spotCheck!.result).toMatchObject({ checked: 3, minor: 1, serious: 2 })
    ;({ index } = await putSnapshot(base, { built: '2026-10-05T11:00:00Z', digests: false }))
    resetSnapshotCache()
    counted.gets.length = 0
    const fromFiles = { mine: await list('/api/assignments'), all: await list('/api/admin/assignments', 'admin@example.com') }
    expect(counted.gets.some((k) => fileKeys().has(k))).toBe(true)
    expect(fromFiles).toEqual(fromDigests)
  })
})

/**
 * A closed assignment's progress and spot-check result are kept as they were when it was closed (#281): nobody
 * works on it any more, and counting it live made Admin → Assignments read the digests of whole queues.
 */
describe('a closed assignment in the lists', () => {
  const post = async (path: string) =>
    createApp(testDeps({ ...base, SNAPSHOTS: counted.bucket })).request(path, {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': await keys.token('admin@example.com', base), origin: base.APP_ORIGIN, 'content-type': 'application/json' },
      body: '{}',
    })
  const kept = async (id: number) => (await base.DB.prepare('SELECT frozen_progress AS f FROM assignments WHERE id = ?').bind(id).first<{ f: string | null }>())!.f
  const levelDigest = () => snapshotDigestKey(index.id, 'level')
  const admins = async () => {
    resetSnapshotCache()
    counted.gets.length = 0
    return list('/api/admin/assignments', 'admin@example.com')
  }
  beforeEach(async () => {
    await get('/api/me', 'admin@example.com')
  })

  it('keeps its figures from the closing, and a list then reads nothing of its queue', async () => {
    const level = (await admins()).find((a) => a.queue === 'level')!
    expect(level.progress).not.toBeNull()
    const closed = (await (await post(`/api/admin/assignments/${level.id}/close`)).json()) as AssignmentView
    expect(closed.closedAt).not.toBeNull()
    expect(JSON.parse((await kept(level.id))!)).toEqual({ progress: level.progress, spotCheck: null })
    const shown = (await admins()).find((a) => a.id === level.id)!
    expect(shown).toEqual(closed)
    expect(shown.progress).toEqual(level.progress)
    expect(counted.gets).not.toContain(levelDigest())
  })

  it('keeps a spot check’s result from the closing', async () => {
    const spot = (await admins()).find((a) => a.spotCheck !== null)!
    expect(spot.spotCheck!.result).toMatchObject({ checked: 3, minor: 1, serious: 2 })
    await post(`/api/admin/assignments/${spot.id}/close`)
    expect(JSON.parse((await kept(spot.id))!)).toEqual({ progress: spot.progress, spotCheck: spot.spotCheck!.result })
    expect((await admins()).find((a) => a.id === spot.id)!.spotCheck).toEqual(spot.spotCheck)
  })

  it('closed before it kept them: is counted once by the first list, which keeps them, and not again', async () => {
    const before = await insertAssignment(base.DB, { reviewer: 'ivan@example.com', queue: 'level', files: '*', flaggedOnly: false, createdAt: 't' })
    await closeAssignment(base.DB, before, 't')
    const [open] = await listAssignments(base.DB, { queue: 'level', open: true })
    await post(`/api/admin/assignments/${open!.id}/close`)
    expect(await kept(before)).toBeNull()
    const first = (await admins()).find((a) => a.id === before)!
    expect(first.progress).toMatchObject({ inScope: expect.any(Number) as number, decided: 0 })
    expect(first.progress!.inScope).toBeGreaterThan(0)
    expect(counted.gets.filter((k) => k === levelDigest())).toHaveLength(1)
    expect(JSON.parse((await kept(before))!)).toEqual({ progress: first.progress, spotCheck: null })
    const again = (await admins()).find((a) => a.id === before)!
    expect(again).toEqual(first)
    expect(counted.gets).not.toContain(levelDigest())
  })

  it('shows the same figures after a snapshot whose rows differ, while an open one is counted anew', async () => {
    const bg = (await admins()).filter((a) => a.queue === 'translation-bg')
    const whole = bg.find((a) => a.closedAt === null && a.files !== '*' && a.spotCheck === null)!
    await post(`/api/admin/assignments/${whole.id}/close`)
    const closedBefore = (await admins()).filter((a) => a.closedAt !== null)
    // A later snapshot in which every file of the queue has lost its first row.
    ;({ index, out } = await putSnapshot(base, { built: '2026-10-06T10:00:00Z' }))
    const digest = JSON.parse(readFileSync(join(out, snapshotDigestKey(index.id, 'translation-bg')), 'utf8')) as QueueDigest
    const fewer: QueueDigest = { files: Object.fromEntries(Object.entries(digest.files).map(([f, rows]) => [f, rows.slice(1)])) }
    await base.SNAPSHOTS.put(snapshotDigestKey(index.id, 'translation-bg'), JSON.stringify(fewer))
    const after = await admins()
    expect(after.filter((a) => a.closedAt !== null)).toEqual(closedBefore)
    const flagged = bg.find((a) => a.closedAt === null && a.flaggedOnly)!
    const openAfter = after.find((a) => a.id === flagged.id)!
    expect(openAfter.progress!.inScope).toBe(flagged.progress!.inScope - Object.values(digest.files).filter((rows) => rows[0]![2]).length)
  })

  it('a closed assignment reassigned is counted anew: its unsubmitted decisions went with the reassignment', async () => {
    const whole = (await admins()).find((a) => a.closedAt === null && a.files !== '*' && a.spotCheck === null)!
    await post(`/api/admin/assignments/${whole.id}/close`)
    expect((await admins()).find((a) => a.id === whole.id)!.progress).toMatchObject({ decided: 1, changed: 1, submitted: 1 })
    // Its file is free again once the other open assignments of the queue, which hold it too, are closed.
    for (const a of await listAssignments(base.DB, { queue: 'translation-bg', open: true })) await closeAssignment(base.DB, a.id, 't')
    const res = await createApp(testDeps({ ...base, SNAPSHOTS: counted.bucket })).request(`/api/admin/assignments/${whole.id}/reassign`, {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': await keys.token('admin@example.com', base), origin: base.APP_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'ivan@example.com', decisions: 'move' }),
    })
    expect(res.status).toBe(200)
    expect((await admins()).find((a) => a.id === whole.id)!.progress).toMatchObject({ decided: 0, changed: 0, submitted: 1 })
  })
})
