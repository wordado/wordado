import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AssignmentView, RowsResponse } from '../../shared/hosted'
import { snapshotFileKey, type SnapshotIndex } from '../../shared/snapshot'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { insertAssignment, insertReviewer, listDecisions, upsertDecision } from '../db'
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
})

const get = async (path: string, email = 'ivan@example.com') =>
  createApp(testDeps(env)).request(path, { headers: { 'cf-access-jwt-assertion': await keys.token(email, env) } })

describe('reviewer reads', () => {
  it('lists only my open assignments, with progress', async () => {
    const mine = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true, createdAt: 't' })
    await insertAssignment(env.DB, { reviewer: 'eve@example.com', queue: 'level', files: '*', flaggedOnly: true, createdAt: 't' })
    const list = (await (await get('/api/assignments')).json()) as AssignmentView[]
    expect(list.map((a) => a.id)).toEqual([mine])
    expect(list[0]!.progress!.inScope).toBeGreaterThan(0)
  })

  it('serves a flagged-only assignment its flagged and reported rows, worst first', async () => {
    const id = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true, createdAt: 't' })
    const body = (await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse
    expect(body.rows.length).toBeGreaterThan(0)
    expect(body.rows.every((r) => r.ai === 'flagged' || r.reports !== '')).toBe(true)
    expect(body.rows[0]!.reports).not.toBe('')
  })

  it('serves a whole-file assignment every row of its files, in file order', async () => {
    const file = index.queues.find((q) => q.queue === 'translation-bg')!.files[0]!
    const id = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: [file.file], flaggedOnly: false, createdAt: 't' })
    const body = (await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse
    expect(body.rows.length).toBe(file.rows)
  })

  it('is 403 for someone else’s assignment', async () => {
    const id = await insertAssignment(env.DB, { reviewer: 'eve@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true, createdAt: 't' })
    expect((await get(`/api/rows?assignment=${id}`)).status).toBe(403)
  })

  it('discards an unsubmitted decision whose row left the snapshot and marks a changed one', async () => {
    const id = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true, createdAt: 't' })
    const first = ((await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse).rows[0]!
    const base = { assignment: id, queue: 'translation-bg', file: first.file, action: 'keep' as const, cells: {}, note: '', decidedAt: 't', submission: null }
    await upsertDecision(env.DB, { ...base, key: first.key, rowHash: 'stale-hash' })
    await upsertDecision(env.DB, { ...base, key: 'gone-9', rowHash: 'x' })
    const body = (await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse
    expect(body.discarded).toEqual(['gone-9'])
    expect(body.rows.find((r) => r.key === first.key)!.decision).toMatchObject({ changed: true })
  })

  it('is 503 and discards nothing while a file the snapshot lists is missing from R2', async () => {
    const id = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: false, createdAt: 't' })
    const first = ((await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse).rows[0]!
    await upsertDecision(env.DB, { assignment: id, queue: 'translation-bg', file: first.file, key: first.key, rowHash: first.rowHash, action: 'keep', cells: {}, note: '', decidedAt: 't', submission: null })
    await (env.SNAPSHOTS as unknown as { delete(key: string): Promise<void> }).delete(snapshotFileKey(index.id, first.file))
    resetSnapshotCache()
    const res = await get(`/api/rows?assignment=${id}`)
    expect(res.status).toBe(503)
    expect(await listDecisions(env.DB, id)).toHaveLength(1)
    const list = (await (await get('/api/assignments')).json()) as AssignmentView[]
    expect(list[0]!.progress).toBeNull()
  })

  it('is 503 while no snapshot exists', async () => {
    await env.SNAPSHOTS.put('current.json', JSON.stringify({ id: 'missing', built: 't', commit: 'c' }))
    resetSnapshotCache()
    const id = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true, createdAt: 't' })
    expect((await get(`/api/rows?assignment=${id}`)).status).toBe(503)
  })
})
