import { SYNC_PROTOCOL_VERSION, type PullRequest } from '@wordado/core'
import { describe, expect, it, vi } from 'vitest'
import { httpStatusOf, httpTransport, SyncHttpError } from './transport'

const pull: PullRequest = { protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: 'd1', documentsSince: 0 }

const answering = (status: number, body: unknown) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

describe('httpTransport (plan 5 contract)', () => {
  it('posts JSON with the session cookie and returns the body', async () => {
    const fetchFn = answering(200, { status: 'upgrade_required', minProtocolVersion: 2 })
    const response = await httpTransport({ fetch: fetchFn }).pull(pull)
    expect(response).toEqual({ status: 'upgrade_required', minProtocolVersion: 2 })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('/v1/sync/pull')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(JSON.parse(String(init?.body))).toEqual(pull)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('throws on any other status, and reports a 401 as an expired sign-in', async () => {
    const onUnauthorized = vi.fn()
    const expired = httpTransport({ fetch: answering(401, { error: 'unauthorized' }), onUnauthorized })
    await expect(expired.pull(pull)).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    const malformed = httpTransport({ fetch: answering(400, { error: 'invalid' }), onUnauthorized })
    await expect(malformed.pull(pull)).rejects.toBeInstanceOf(SyncHttpError)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('names the learner it means to sync, and reports a 409 (another learner signed in) like an expired sign-in', async () => {
    let user: string | null = 'u1'
    const fetchFn = answering(200, { status: 'ok' })
    const transport = httpTransport({ fetch: fetchFn, expectedUser: () => user })
    await transport.pull(pull)
    expect(new Headers(fetchFn.mock.calls[0]![1]?.headers).get('x-wordado-user')).toBe('u1')
    user = null
    await transport.pull(pull)
    expect(new Headers(fetchFn.mock.calls[1]![1]?.headers).has('x-wordado-user')).toBe(false)
    const onUnauthorized = vi.fn()
    const wrong = httpTransport({ fetch: answering(409, { error: 'wrong_user' }), onUnauthorized, expectedUser: () => 'u1' })
    const err = await wrong.pull(pull).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SyncHttpError)
    expect(err).toMatchObject({ status: 409 })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('names the status in the message, so the sync status can read it back', () => {
    expect(new SyncHttpError(400).message).toBe('HTTP 400')
    expect(httpStatusOf('HTTP 400')).toBe(400)
    expect(httpStatusOf('Failed to fetch')).toBeNull()
    expect(httpStatusOf(null)).toBeNull()
  })
})
