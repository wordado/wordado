import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ReviewerView } from '../../shared/hosted'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { listAssignments } from '../db'
import { resetSnapshotCache } from '../snapshotStore'
import { testKeys } from '../test/jwt'
import { resetDb, startPlatform, testDeps } from '../test/platform'
import { putSnapshot } from '../test/snapshot'

let env: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
let mails: { to: string[] }[] = []
let failMail = false

beforeAll(async () => {
  keys = await testKeys()
  const p = await startPlatform()
  env = { ...p.env, ACCESS_JWKS: keys.jwks, RESEND_API_KEY: 're_test' }
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(async () => {
  await resetDb(env.DB)
  resetSnapshotCache()
  await putSnapshot(env)
  mails = []
  failMail = false
})

const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
  if (failMail) return new Response('fail', { status: 500 })
  const body = JSON.parse(String(init?.body)) as { to: string[] }
  mails.push({ to: body.to })
  return new Response('{}', { status: 200 })
}

const as = async (email: string, method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) =>
  createApp(testDeps(env, { fetch })).request(path, {
    method,
    headers: {
      'cf-access-jwt-assertion': await keys.token(email, env),
      ...(body !== undefined ? { origin: env.APP_ORIGIN, 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

// The admin reviewer is created on their first request (GET /api/me), as app.ts does for ADMIN_EMAIL.
const admin = async (method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) => {
  await as('admin@example.com', 'GET', '/api/me')
  return as('admin@example.com', method, path, body)
}

describe('admin reviewers', () => {
  it('invites a reviewer and records that the invite went out', async () => {
    const res = await admin('POST', '/api/admin/reviewers', { email: 'Anna@Example.com', name: 'Anna', languages: ['de'] })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { reviewer: ReviewerView; inviteSent: boolean; link: string }
    expect(body.reviewer.email).toBe('anna@example.com')
    expect(body.inviteSent).toBe(true)
    expect(body.reviewer.inviteSentAt).not.toBeNull()
    expect(mails).toHaveLength(1)
  })
  it('still creates the reviewer when the mail fails, and says so', async () => {
    failMail = true
    const body = (await (await admin('POST', '/api/admin/reviewers', { email: 'b@example.com', name: 'B', languages: ['bg'] })).json()) as { reviewer: ReviewerView; inviteSent: boolean; link: string }
    expect(body.inviteSent).toBe(false)
    expect(body.link).toBe(env.APP_ORIGIN)
    expect(body.reviewer.inviteSentAt).toBeNull()
  })
  it('refuses a bad email, no languages, an unknown language, and a duplicate', async () => {
    expect((await admin('POST', '/api/admin/reviewers', { email: 'nope', name: 'N', languages: ['de'] })).status).toBe(400)
    expect((await admin('POST', '/api/admin/reviewers', { email: 'n@example.com', name: 'N', languages: [] })).status).toBe(400)
    expect((await admin('POST', '/api/admin/reviewers', { email: 'n@example.com', name: 'N', languages: ['fr'] })).status).toBe(400)
    await admin('POST', '/api/admin/reviewers', { email: 'n@example.com', name: 'N', languages: ['de'] })
    expect((await admin('POST', '/api/admin/reviewers', { email: 'N@example.com', name: 'N', languages: ['de'] })).status).toBe(409)
  })
  it('disabling closes the reviewer’s assignments and locks them out; enabling lets them back in', async () => {
    await admin('POST', '/api/admin/reviewers', { email: 'ivan@example.com', name: 'Ivan', languages: ['bg'] })
    await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })
    await admin('PATCH', '/api/admin/reviewers/ivan@example.com', { disabled: true })
    expect((await as('ivan@example.com', 'GET', '/api/me')).status).toBe(403)
    expect((await listAssignments(env.DB, { reviewer: 'ivan@example.com', open: true }))).toHaveLength(0)
    await admin('PATCH', '/api/admin/reviewers/ivan@example.com', { disabled: false })
    expect((await as('ivan@example.com', 'GET', '/api/me')).status).toBe(200)
  })
  it('removing a language closes that language’s assignments only', async () => {
    await admin('POST', '/api/admin/reviewers', { email: 'ivan@example.com', name: 'Ivan', languages: ['bg', 'en'] })
    await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })
    await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'level', files: '*', flaggedOnly: true })
    await admin('PATCH', '/api/admin/reviewers/ivan@example.com', { languages: ['en'] })
    expect((await listAssignments(env.DB, { reviewer: 'ivan@example.com', open: true })).map((a) => a.queue)).toEqual(['level'])
  })
  it('an admin cannot disable or demote themselves', async () => {
    expect((await admin('PATCH', '/api/admin/reviewers/admin@example.com', { disabled: true })).status).toBe(400)
    expect((await admin('PATCH', '/api/admin/reviewers/admin@example.com', { role: 'reviewer' })).status).toBe(400)
  })
  it('resends an invite', async () => {
    await admin('POST', '/api/admin/reviewers', { email: 'b@example.com', name: 'B', languages: ['bg'] })
    expect(((await (await admin('POST', '/api/admin/reviewers/b@example.com/invite', {})).json()) as { inviteSent: boolean }).inviteSent).toBe(true)
    expect(mails).toHaveLength(2)
  })
})
