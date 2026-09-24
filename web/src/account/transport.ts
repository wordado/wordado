import type { SyncTransport } from '@wordado/client-data'
import type { PullRequest, PullResponse, PushPage, PushResponse } from '@wordado/core'
import type { Fetch } from '../content/packs'

/** One sync request's limit: a hung request must not hold the outbox or a hand-over forever. Tuning (§15). */
export const SYNC_REQUEST_TIMEOUT_MS = 30_000

/** A sync request the server answered with anything but 200. The message is what `SyncStatus.lastError` keeps. */
export class SyncHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
    this.name = 'SyncHttpError'
  }
}

/** The status a sync failure carried, read back from `SyncStatus.lastError`; null for a network failure. */
export function httpStatusOf(lastError: string | null): number | null {
  const match = lastError === null ? null : /^HTTP (\d{3})$/.exec(lastError)
  return match ? Number(match[1]) : null
}

/** Names the learner a request is meant for; the server refuses it with 409 when the session is someone else's. */
export const EXPECTED_USER_HEADER = 'x-wordado-user'

/** The header naming `userId`, or none when no learner is recorded. */
export const expectedUserHeader = (userId: string | null): Record<string, string> => (userId === null ? {} : { [EXPECTED_USER_HEADER]: userId })

export interface TransportOptions {
  readonly fetch?: Fetch
  /**
   * Called on a 401 (the session has expired or was signed out elsewhere) and
   * on a 409 (the session is another learner's): either way the learner must
   * sign in again before this device syncs (spec §8.6).
   */
  readonly onUnauthorized?: () => void
  /** The learner this device's file belongs to, sent with every request; null sends none. */
  readonly expectedUser?: () => string | null
  readonly timeoutMs?: number
}

/**
 * `client-data`'s transport on the web (plan 5 contract): two POSTs with the
 * session cookie. Anything but a 200 throws, and the sync engine treats every
 * throw as retryable; `upgrade_required` arrives inside a 200.
 */
export function httpTransport(options: TransportOptions = {}): SyncTransport {
  const fetchFn = options.fetch ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? SYNC_REQUEST_TIMEOUT_MS
  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetchFn(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...expectedUserHeader(options.expectedUser?.() ?? null) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 401 || response.status === 409) options.onUnauthorized?.()
    if (response.status !== 200) throw new SyncHttpError(response.status)
    return (await response.json()) as T
  }
  return {
    push: (page: PushPage) => post<PushResponse>('/v1/sync/push', page),
    pull: (request: PullRequest) => post<PullResponse>('/v1/sync/pull', request),
  }
}
