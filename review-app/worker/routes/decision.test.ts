import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { RowsResponse } from '../../shared/hosted'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { insertAssignment, insertReviewer, insertSubmission, listDecisions, markSubmitted, upsertDecision } from '../db'
import { severityOf } from './decision'
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

  it('takes a new decision on a row that changed after its decision was merged', async () => {
    await upsertDecision(env.DB, { assignment: id, queue: row.queue, file: 'review/translation-bg/old.csv', key: row.key, rowHash: 'the-old-proposal', action: 'keep', cells: {}, note: '', decidedAt: 't', submission: null })
    const sub = await insertSubmission(env.DB, { assignment: id, branch: 'b', pr: 1, url: null, count: 1, leftOut: 0, status: 'merged', createdAt: 't' })
    await markSubmitted(env.DB, id, [row.key], sub)
    const res = await post('POST', { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'drop' })
    expect(res.status).toBe(200)
    expect((await listDecisions(env.DB, id)).filter((d) => d.key === row.key)).toMatchObject([{ rowHash: row.rowHash, file: row.file, action: 'drop', submission: null }])
  })

  it('is 409 for a row that changed while its decision waits in an open pull request', async () => {
    await upsertDecision(env.DB, { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: 'the-old-proposal', action: 'keep', cells: {}, note: '', decidedAt: 't', submission: null })
    const sub = await insertSubmission(env.DB, { assignment: id, branch: 'b', pr: 1, url: null, count: 1, leftOut: 0, status: 'open', createdAt: 't' })
    await markSubmitted(env.DB, id, [row.key], sub)
    expect((await post('POST', { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'drop' })).status).toBe(409)
  })
})

describe('severityOf', () => {
  it('asks a spot check for a severity with every action but keep', () => {
    expect(severityOf(true, 'keep', undefined)).toBeNull()
    expect(severityOf(true, 'edit', 'minor')).toBe('minor')
    expect(severityOf(true, 'drop', 'major')).toBe('major')
    expect(severityOf(true, 'accept', 'minor')).toBe('minor')
    for (const action of ['edit', 'drop', 'accept'] as const) expect(severityOf(true, action, undefined)).toMatchObject({ invalid: expect.stringMatching(/how serious/) })
    expect(severityOf(true, 'edit', 'grave')).toMatchObject({ invalid: expect.any(String) })
    expect(severityOf(true, 'keep', 'minor')).toMatchObject({ invalid: expect.stringMatching(/kept/) })
  })

  it('refuses a severity outside a spot check', () => {
    expect(severityOf(false, 'edit', undefined)).toBeNull()
    expect(severityOf(false, 'edit', null)).toBeNull()
    expect(severityOf(false, 'edit', 'minor')).toMatchObject({ invalid: expect.stringMatching(/only a spot check/) })
  })
})

describe('POST /api/decision in a spot check', () => {
  let spot: number
  let rows: RowsResponse['rows']
  let outside: RowsResponse['rows'][number]
  const decide = (r: RowsResponse['rows'][number], body: Record<string, unknown>, assignment = spot) =>
    post('POST', { assignment, queue: r.queue, file: r.file, key: r.key, rowHash: r.rowHash, ...body })

  beforeEach(async () => {
    const everything = await insertAssignment(env.DB, { reviewer: 'eve@example.com', queue: 'translation-bg', files: '*', flaggedOnly: false, createdAt: 't' })
    const all = ((await (await get(`/api/rows?assignment=${everything}`, 'eve@example.com')).json()) as RowsResponse).rows
    const passed = all.filter((r) => r.ai === 'passed' && r.reports === '')
    const sample = passed.slice(0, 3).map((r) => ({ file: r.file, key: r.key }))
    outside = passed[3]!
    spot = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: [passed[0]!.file], flaggedOnly: false, spotCheck: { seed: 1, sample }, createdAt: 't' })
    rows = ((await (await get(`/api/rows?assignment=${spot}`)).json()) as RowsResponse).rows
  })

  it('serves the sample only, and refuses a row of the same file that is not in it', async () => {
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.key)).not.toContain(outside.key)
    expect(outside.file).toBe(rows[0]!.file)
    const res = await decide(outside, { action: 'keep' })
    expect(res.status).toBe(403)
    expect(await listDecisions(env.DB, spot)).toEqual([])
  })

  it('keeps a row without a severity', async () => {
    expect((await decide(rows[0]!, { action: 'keep' })).status).toBe(200)
    expect(await listDecisions(env.DB, spot)).toMatchObject([{ action: 'keep', severity: null }])
  })

  it('needs a severity to edit or drop, and stores it', async () => {
    for (const body of [{ action: 'edit', cells: { translation: 'x' } }, { action: 'drop' }, { action: 'drop', severity: 'grave' }, { action: 'accept' }]) {
      const res = await decide(rows[0]!, body)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ ok: false, reason: 'invalid', message: expect.stringMatching(/major or minor/) })
    }
    expect(await listDecisions(env.DB, spot)).toEqual([])
    expect((await decide(rows[0]!, { action: 'edit', cells: { translation: 'x' }, severity: 'minor' })).status).toBe(200)
    expect((await decide(rows[1]!, { action: 'drop', severity: 'major' })).status).toBe(200)
    expect((await listDecisions(env.DB, spot)).map((d) => [d.action, d.severity]).sort()).toEqual([['drop', 'major'], ['edit', 'minor']])
    const shown = ((await (await get(`/api/rows?assignment=${spot}`)).json()) as RowsResponse).rows
    expect(shown.map((r) => r.decision?.severity ?? null)).toEqual(['minor', 'major', null])
  })

  it('takes an accept with a severity without falling over, though a sampled row has nothing to accept', async () => {
    expect((await decide(rows[0]!, { action: 'accept', severity: 'minor' })).status).toBe(200)
  })

  it('forgets the severity when the reviewer changes their mind to keep, and refuses one sent with keep', async () => {
    await decide(rows[0]!, { action: 'drop', severity: 'major' })
    expect((await decide(rows[0]!, { action: 'keep', severity: 'major' })).status).toBe(400)
    expect((await decide(rows[0]!, { action: 'keep' })).status).toBe(200)
    expect(await listDecisions(env.DB, spot)).toMatchObject([{ action: 'keep', severity: null }])
  })

  it('refuses a severity on an assignment that is not a spot check', async () => {
    const res = await decide(row, { action: 'edit', cells: { translation: 'x' }, severity: 'minor' }, id)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ reason: 'invalid', message: expect.stringMatching(/only a spot check/) })
    expect((await decide(row, { action: 'edit', cells: { translation: 'x' } }, id)).status).toBe(200)
    expect(await listDecisions(env.DB, id)).toMatchObject([{ action: 'edit', severity: null }])
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
