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
