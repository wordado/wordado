import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostedApi } from './hostedApi'

afterEach(() => vi.unstubAllGlobals())
const respond = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

describe('hostedApi.me', () => {
  it('is local on 404, signed out on 401, denied with the message on 403', async () => {
    respond(404, { message: 'no such API' })
    expect(await hostedApi.me()).toEqual({ kind: 'local' })
    respond(401, { message: 'sign in again' })
    expect(await hostedApi.me()).toEqual({ kind: 'signedOut' })
    respond(403, { message: 'no invitation' })
    expect(await hostedApi.me()).toEqual({ kind: 'denied', message: 'no invitation' })
    respond(403, { message: 'no invitation', email: 'stranger@example.com' })
    expect(await hostedApi.me()).toEqual({ kind: 'denied', message: 'no invitation', email: 'stranger@example.com' })
    respond(200, { email: 'a@example.com', name: 'A', role: 'reviewer', languages: ['de'] })
    expect(await hostedApi.me()).toMatchObject({ kind: 'me', me: { name: 'A' } })
  })
})

describe('hostedApi.decide', () => {
  it('returns 409 and 410 bodies as results and throws on 5xx', async () => {
    respond(409, { ok: false, reason: 'changed', message: 'changed' })
    expect(await hostedApi.decide({ assignment: 1, queue: 'q', file: 'f', key: 'k', rowHash: 'h', action: 'keep' })).toMatchObject({ reason: 'changed' })
    respond(500, { message: 'internal error' })
    await expect(hostedApi.decide({ assignment: 1, queue: 'q', file: 'f', key: 'k', rowHash: 'h', action: 'keep' })).rejects.toThrow('internal error')
  })
})

describe('hostedApi.admin: the AI help on feedback', () => {
  it('asks for the status, sets the switch, has a page read by the page’s own coordinates, and forgets the results', async () => {
    const fetched = vi.fn(async (_path: string, _init?: RequestInit) => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetched)
    const json = { 'content-type': 'application/json' }
    await hostedApi.admin.feedbackAi()
    expect(fetched.mock.calls[0]).toEqual(['/api/admin/feedback/ai'])
    await hostedApi.admin.setFeedbackAi(true)
    expect(fetched.mock.calls[1]).toEqual(['/api/admin/feedback/ai', { method: 'PUT', headers: json, body: '{"on":true}' }])
    await hostedApi.admin.readFeedbackAi({ kind: 'bug', before: 40 })
    expect(fetched.mock.calls[2]).toEqual(['/api/admin/feedback/ai/read', { method: 'POST', headers: json, body: '{"kind":"bug","before":40}' }])
    await hostedApi.admin.readFeedbackAi({ kind: '' })
    expect(fetched.mock.calls[3]).toEqual(['/api/admin/feedback/ai/read', { method: 'POST', headers: json, body: '{"kind":"","before":null}' }])
    await hostedApi.admin.forgetFeedbackAi()
    expect(fetched.mock.calls[4]).toEqual(['/api/admin/feedback/ai/results', { method: 'DELETE', headers: json, body: '{}' }])
  })
})
