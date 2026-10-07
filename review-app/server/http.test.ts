import type { AddressInfo } from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { reviewFixture } from './fixture'
import { createReviewServer } from './http'
import type { RowView } from './types'

let close: (() => void) | null = null
afterEach(() => close?.())

async function start(staticDir: string | null = null) {
  const dir = await reviewFixture()
  const server = createReviewServer({ dir, staticDir, settings: join(mkdtempSync(join(tmpdir(), 'home-')), 'review-app.json'), now: () => '2026-10-05T00:00:00Z' })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  close = () => server.close()
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const json = async (path: string, init?: RequestInit) => {
    const res = await fetch(base + path, init ? { ...init, headers: { 'content-type': 'application/json' } } : undefined)
    return { status: res.status, body: (await res.json()) as unknown }
  }
  return { base, json }
}

describe('the review server', () => {
  it('lists queues and rows, saves a decision, and refuses a stale save with 409', async () => {
    const s = await start()
    expect((await s.json('/api/queues')).status).toBe(200)
    const rows = (await s.json('/api/rows?queue=translation-bg')).body as RowView[]
    const row = rows.find((r) => r.key.startsWith('bank-'))!
    const save = (version: string) => s.json('/api/decision', { method: 'POST', body: JSON.stringify({ queue: row.queue, file: row.file, version, key: row.key, action: 'keep', cells: row.cells }) })
    expect((await save(row.version)).status).toBe(200)
    expect((await save(row.version)).status).toBe(409)
  })

  it('imports under the stored reviewer, and refuses without one', async () => {
    const s = await start()
    expect((await s.json('/api/import', { method: 'POST', body: '{}' })).status).toBe(400)
    await s.json('/api/reviewer', { method: 'POST', body: JSON.stringify({ reviewer: 'tester' }) })
    expect((await s.json('/api/reviewer')).body).toEqual({ reviewer: 'tester' })
    const res = await s.json('/api/import', { method: 'POST', body: '{}' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ errors: [] })
  })

  it('answers 404 for an unknown API path', async () => {
    const s = await start()
    expect((await fetch(`${s.base}/api/nothing`)).status).toBe(404)
  })

  it('serves a file from staticDir, and keeps a path-traversal attempt inside it by falling back to index.html', async () => {
    const staticDir = mkdtempSync(join(tmpdir(), 'static-'))
    writeFileSync(join(staticDir, 'index.html'), '<html>index</html>')
    writeFileSync(join(staticDir, 'app.js'), 'console.log(1)')
    const s = await start(staticDir)

    const appJs = await fetch(`${s.base}/app.js`)
    expect(appJs.status).toBe(200)
    expect(await appJs.text()).toBe('console.log(1)')

    const traversal1 = await fetch(`${s.base}/..%2f..%2fpackage.json`)
    expect(traversal1.status).toBe(200)
    expect(await traversal1.text()).toBe('<html>index</html>')

    const traversal2 = await fetch(`${s.base}/%2e%2e/%2e%2e/package.json`)
    expect(traversal2.status).toBe(200)
    expect(await traversal2.text()).toBe('<html>index</html>')
  })

  it('serves the icons with their types', async () => {
    const staticDir = mkdtempSync(join(tmpdir(), 'static-'))
    writeFileSync(join(staticDir, 'index.html'), '<html>index</html>')
    writeFileSync(join(staticDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    writeFileSync(join(staticDir, 'apple-touch-icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const s = await start(staticDir)
    expect((await fetch(`${s.base}/icon.svg`)).headers.get('content-type')).toBe('image/svg+xml')
    expect((await fetch(`${s.base}/apple-touch-icon.png`)).headers.get('content-type')).toBe('image/png')
  })

  it('falls back to index.html for malformed percent-encoding instead of a 500', async () => {
    const staticDir = mkdtempSync(join(tmpdir(), 'static-'))
    writeFileSync(join(staticDir, 'index.html'), '<html>index</html>')
    const s = await start(staticDir)
    const res = await fetch(`${s.base}/%E0%A4%A`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<html>index</html>')
  })

  it('answers 400, not 500, for a malformed JSON body on a POST route', async () => {
    const s = await start()
    expect((await s.json('/api/decision', { method: 'POST', body: '{not json' })).status).toBe(400)
    expect((await s.json('/api/reviewer', { method: 'POST', body: '{not json' })).status).toBe(400)
  })

  it('refuses a request whose Host header is not this server, with 403', async () => {
    // fetch() forbids setting a custom Host header (it always sends the URL's own), so this needs node:http directly.
    const s = await start()
    const port = Number(new URL(s.base).port)
    const status = await new Promise<number | undefined>((resolvePromise, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/api/queues', method: 'GET', headers: { host: 'evil.example' } }, (res) => {
        res.resume()
        res.on('end', () => resolvePromise(res.statusCode))
      })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })

  it('refuses a POST without content-type: application/json, with 415, but still accepts a normal one', async () => {
    const s = await start()
    const plain = await fetch(`${s.base}/api/reviewer`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"reviewer":"tester"}' })
    expect(plain.status).toBe(415)
    const ok = await s.json('/api/reviewer', { method: 'POST', body: JSON.stringify({ reviewer: 'tester' }) })
    expect(ok.status).toBe(200)
  })
})
