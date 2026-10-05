import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api', () => {
  it('throws an Error with the server message for a non-2xx GET', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { message: 'boom' }))
    await expect(api.queues()).rejects.toThrow('boom')
  })

  it('throws an Error with the server message for a non-2xx POST', async () => {
    vi.stubGlobal('fetch', mockFetch(400, { message: 'a name is needed' }))
    await expect(api.setReviewer('x')).rejects.toThrow('a name is needed')
  })

  it('decide resolves its DecisionResult for 400/409/410 instead of throwing', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { ok: false, reason: 'changed', message: 'changed since loaded' }))
    const res = await api.decide({ queue: 'q', file: 'f', version: 'v', key: 'k', action: 'keep' })
    expect(res).toEqual({ ok: false, reason: 'changed', message: 'changed since loaded' })
  })

  it('decide throws on a 5xx', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { message: 'server crashed' }))
    await expect(api.decide({ queue: 'q', file: 'f', version: 'v', key: 'k', action: 'keep' })).rejects.toThrow('server crashed')
  })
})
