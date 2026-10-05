import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { insertReviewer } from '../db'
import { testKeys } from '../test/jwt'
import { resetDb, startPlatform, testDeps } from '../test/platform'

let env: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
beforeAll(async () => {
  keys = await testKeys()
  const p = await startPlatform()
  env = { ...p.env, ACCESS_JWKS: keys.jwks }
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(() => resetDb(env.DB))

const me = async (email: string | null) =>
  createApp(testDeps(env)).request('/api/me', { headers: email ? { 'cf-access-jwt-assertion': await keys.token(email, env) } : {} })

describe('GET /api/me', () => {
  it('is 401 without a token', async () => {
    expect((await me(null)).status).toBe(401)
  })
  it('is 403 for an email nobody invited', async () => {
    expect((await me('stranger@example.com')).status).toBe(403)
  })
  it('creates the first admin from ADMIN_EMAIL', async () => {
    const res = await me('ADMIN@example.com')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'admin@example.com', name: 'Coordinator', role: 'admin', languages: ['bg', 'de', 'es', 'en'] })
  })
  it('knows an invited reviewer whatever the email case, and refuses a disabled one', async () => {
    await insertReviewer(env.DB, { email: 'anna@example.com', name: 'Anna', languages: ['de'], role: 'reviewer', invitedAt: '2026-10-05T00:00:00Z', inviteSentAt: null, disabledAt: null })
    const ok = await me('Anna@Example.com')
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { name: string }).name).toBe('Anna')
    await env.DB.prepare('UPDATE reviewers SET disabled_at = ? WHERE email = ?').bind('2026-10-05T01:00:00Z', 'anna@example.com').run()
    expect((await me('anna@example.com')).status).toBe(403)
  })
})
