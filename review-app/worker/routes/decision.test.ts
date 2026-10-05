import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { RowsResponse } from '../../shared/hosted'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { insertAssignment, insertReviewer, insertSubmission, markSubmitted } from '../db'
import { resetSnapshotCache } from '../snapshotStore'
import { testKeys } from '../test/jwt'
import { resetDb, startPlatform, testDeps } from '../test/platform'
import { putSnapshot } from '../test/snapshot'

let env: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
let id: number
let row: RowsResponse['rows'][number]

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
  await putSnapshot(env)
  await insertReviewer(env.DB, { email: 'ivan@example.com', name: 'Ivan', languages: ['bg', 'en'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
  await insertReviewer(env.DB, { email: 'eve@example.com', name: 'Eve', languages: ['bg'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
  id = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true, createdAt: 't' })
  row = ((await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse).rows[0]!
})

const get = async (path: string, email = 'ivan@example.com') =>
  createApp(testDeps(env)).request(path, { headers: { 'cf-access-jwt-assertion': await keys.token(email, env) } })

const post = async (method: 'POST' | 'DELETE', body: unknown, email = 'ivan@example.com') =>
  createApp(testDeps(env)).request('/api/decision', {
    method,
    headers: { 'cf-access-jwt-assertion': await keys.token(email, env), origin: env.APP_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /api/decision', () => {
  it('stores a decision and shows it on the row; a second one replaces it', async () => {
    const req = { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'edit', cells: { translation: 'бряг' }, note: 'n' }
    expect((await post('POST', req)).status).toBe(200)
    expect((await post('POST', { ...req, action: 'keep', cells: {} })).status).toBe(200)
    const rows = ((await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse).rows
    expect(rows.find((r) => r.key === row.key)!.decision).toMatchObject({ action: 'keep', changed: false })
  })

  it('is 409 changed when the row hash differs from the snapshot', async () => {
    const res = await post('POST', { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: 'old', action: 'keep' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ ok: false, reason: 'changed' })
  })

  it('is 410 gone for a key not in the file', async () => {
    expect((await post('POST', { assignment: id, queue: row.queue, file: row.file, key: 'nope-1', rowHash: 'x', action: 'keep' })).status).toBe(410)
  })

  it('is 400 for an unknown action, a drop on a title queue, or a cell outside the columns', async () => {
    expect((await post('POST', { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'zap' })).status).toBe(400)
    expect((await post('POST', { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'edit', cells: { headword: 'x' } })).status).toBe(400)
  })

  it('is 400 for a drop on a queue without drop (title-bg)', async () => {
    const titleId = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'title-bg', files: '*', flaggedOnly: false, createdAt: 't' })
    const titleRow = ((await (await get(`/api/rows?assignment=${titleId}`)).json()) as RowsResponse).rows[0]!
    const res = await post('POST', { assignment: titleId, queue: 'title-bg', file: titleRow.file, key: titleRow.key, rowHash: titleRow.rowHash, action: 'drop' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('is 403 for a row outside the assignment or someone else’s assignment', async () => {
    expect((await post('POST', { assignment: id, queue: 'level', file: row.file, key: row.key, rowHash: row.rowHash, action: 'keep' })).status).toBe(403)
    expect((await post('POST', { assignment: id, queue: row.queue, file: 'review/translation-bg/other.csv', key: row.key, rowHash: row.rowHash, action: 'keep' })).status).toBe(403)
    expect((await post('POST', { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'keep' }, 'eve@example.com')).status).toBe(403)
  })

  it('is 409 for a row already submitted', async () => {
    const req = { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'keep' }
    await post('POST', req)
    const sub = await insertSubmission(env.DB, { assignment: id, branch: 'b', pr: 1, url: null, count: 1, leftOut: 0, status: 'open', createdAt: 't' })
    await markSubmitted(env.DB, id, [row.key], sub)
    const res = await post('POST', req)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'changed', message: expect.stringMatching(/submitted/) })
  })

  it('is 409 for a row whose submission was merged', async () => {
    const req = { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'keep' }
    await post('POST', req)
    const sub = await insertSubmission(env.DB, { assignment: id, branch: 'b', pr: 1, url: null, count: 1, leftOut: 0, status: 'merged', createdAt: 't' })
    await markSubmitted(env.DB, id, [row.key], sub)
    const res = await post('POST', { ...req, action: 'drop' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'changed', message: expect.stringMatching(/submitted/) })
  })
})

describe('DELETE /api/decision', () => {
  it('undoes an unsubmitted decision', async () => {
    await post('POST', { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'keep' })
    expect((await post('DELETE', { assignment: id, key: row.key })).status).toBe(200)
    const rows = ((await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse).rows
    expect(rows.find((r) => r.key === row.key)!.decision).toBeNull()
  })
})
