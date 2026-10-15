import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AssignmentView } from '../../shared/hosted'
import { snapshotDigestKey, snapshotFileKey, type SnapshotFile, type SnapshotIndex } from '../../shared/snapshot'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { closeAssignment, insertAssignment, insertReviewer, insertSubmission, upsertDecision } from '../db'
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
