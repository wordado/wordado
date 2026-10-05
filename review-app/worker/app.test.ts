import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { startPlatform, testDeps } from './test/platform'
import type { Env } from './bindings'

let env: Env
let dispose: () => Promise<void>
beforeAll(async () => ({ env, dispose } = await startPlatform()))
afterAll(() => dispose())

describe('request rules', () => {
  const app = () => createApp(testDeps(env))

  it('refuses a POST from another origin', async () => {
    const res = await app().request('/api/decision', { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(403)
  })

  it('refuses a POST without JSON', async () => {
    const res = await app().request('/api/decision', { method: 'POST', headers: { origin: 'https://review.test', 'content-type': 'text/plain' }, body: 'x' })
    expect(res.status).toBe(415)
  })

  it('answers 404 JSON for an unknown API path', async () => {
    const res = await app().request('/api/nothing-here', { headers: {} })
    expect([401, 404]).toContain(res.status)
    expect(res.headers.get('content-type')).toMatch(/json/)
  })

  it('has the schema', async () => {
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>()
    expect(tables.results.map((t) => t.name)).toEqual(expect.arrayContaining(['assignments', 'decisions', 'reviewers', 'submissions']))
  })
})
