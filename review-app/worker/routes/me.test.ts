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
    const res = await me('Stranger@example.com')
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ email: 'stranger@example.com' })
  })
  it('creates the first admin from ADMIN_EMAIL', async () => {
    const res = await me('ADMIN@example.com')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'admin@example.com', name: 'Coordinator', role: 'admin', languages: ['bg', 'de', 'es', 'en'] })
  })
  it('creates the first admin once when their first requests race', async () => {
    const results = await Promise.all([me('admin@example.com'), me('admin@example.com'), me('admin@example.com')])
    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM reviewers').first<{ n: number }>()
    expect(n?.n).toBe(1)
  })
  it('answers 403, not 500, and warns when ADMIN_EMAIL is unset', async () => {
    const logs: string[] = []
    const { ADMIN_EMAIL: _, ...rest } = env
    const noAdmin = rest as Env
    const res = await createApp(testDeps(noAdmin, { log: (l) => logs.push(l) })).request('/api/me', { headers: { 'cf-access-jwt-assertion': await keys.token('admin@example.com', env) } })
    expect(res.status).toBe(403)
    expect(logs.some((l) => l.includes('ADMIN_EMAIL'))).toBe(true)
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
