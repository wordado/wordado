import type { FeedbackInput } from '@wordado/core'
import type { Fetch } from '../content/packs'
import type { Locale } from '../i18n/i18n'
import { expectedUserHeader } from './transport'

/** The server answered, with something other than success. `code` is the body's `error` or Better Auth's `code`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`The server answered ${status}${code ? ` (${code})` : ''}`)
    this.name = 'ApiError'
  }
}

/** The request got no answer at all: offline, or the server is unreachable. */
export class OfflineError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'OfflineError'
  }
}

/** `GET /v1/me` (plan 5). */
export interface Me {
  readonly userId: string
  readonly email: string
  readonly createdAt: number
}

/** `PUT /v1/push/subscription` (plan 5, spec §8.11). */
export interface PushSubscriptionBody {
  readonly endpoint: string
  readonly keys: { readonly p256dh: string; readonly auth: string }
  /** Minute of the local day, 0–1439. */
  readonly reminderMinute: number
  /** Minutes to add to UTC, as on every event. */
  readonly tzOffsetMin: number
  readonly language: Locale
  readonly streakNudge: boolean
}

/** `GET /v1/export` (spec §11): the learner's data, and the name the server gave the file. */
export interface ExportFile {
  readonly name: string
  readonly json: string
}

/** `POST /v1/feedback` (spec §8.12): the message, the details shown under the form, and the field no person fills in. */
export interface FeedbackBody extends FeedbackInput {
  readonly website: string
}

/** Everything the app asks of the server beside sync (spec §8.6, §8.11, §8.12, §11). */
export interface Api {
  sendCode(email: string): Promise<void>
  verifyCode(email: string, code: string): Promise<void>
  /** The signed-in learner, or null without a valid session. */
  me(): Promise<Me | null>
  /** The request's country as the host reads it, to pre-fill the age gate; null when unknown. */
  requestCountry(): Promise<string | null>
  signOut(): Promise<void>
  deleteAccount(): Promise<void>
  /** The data export, for the recorded learner only (409 when the session is someone else's). */
  exportData(): Promise<ExportFile>
  /** The VAPID key, or null when this server sends no reminders. */
  pushPublicKey(): Promise<string | null>
  putSubscription(body: PushSubscriptionBody): Promise<void>
  deleteSubscription(endpoint: string): Promise<void>
  /** Feedback about the app, signed in or not: with a session the server attaches the account. */
  sendFeedback(body: FeedbackBody): Promise<void>
}

const codeOf = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) return null
  const { error, code } = body as { error?: unknown; code?: unknown }
  return typeof error === 'string' ? error : typeof code === 'string' ? code : null
}

/**
 * The app's calls to its own origin: `/api/auth` (Better Auth) and `/v1` (plan 5), with the session cookie.
 * `expectedUser` names the recorded learner on the push-subscription calls, the account deletion and
 * the export, so a session that is someone else's is refused (409) rather than acted on; on feedback,
 * so such a session's account is not attached to it.
 */
export function httpApi(fetchFn: Fetch = (input, init) => fetch(input, init), expectedUser: () => string | null = () => null): Api {
  async function request(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<{ readonly response: Response; readonly text: string; readonly parsed: unknown }> {
    let response: Response
    try {
      response = await fetchFn(path, {
        method,
        credentials: 'include',
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (err) {
      throw new OfflineError(err)
    }
    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text === '' ? null : JSON.parse(text)
    } catch {
      parsed = null
    }
    if (!response.ok) throw new ApiError(response.status, codeOf(parsed))
    return { response, text, parsed }
  }

  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<unknown> =>
    (await request(method, path, body, extra)).parsed

  const unauthorizedAsNull = async <T>(work: Promise<T>): Promise<T | null> => {
    try {
      return await work
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null
      throw err
    }
  }

  return {
    sendCode: async (email) => {
      await call('POST', '/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
    },
    verifyCode: async (email, code) => {
      await call('POST', '/api/auth/sign-in/email-otp', { email, otp: code })
    },
    me: () => unauthorizedAsNull(call('GET', '/v1/me') as Promise<Me>),
    requestCountry: async () => {
      const country = ((await call('GET', '/v1/country')) as { country?: unknown } | null)?.country
      return typeof country === 'string' ? country : null
    },
    signOut: async () => {
      await call('POST', '/api/auth/sign-out', {})
    },
    deleteAccount: async () => {
      await call('DELETE', '/v1/account', { confirm: true }, expectedUserHeader(expectedUser()))
    },
    exportData: async () => {
      const { response, text } = await request('GET', '/v1/export', undefined, expectedUserHeader(expectedUser()))
      const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'wordado-export.json'
      return { name, json: text }
    },
    pushPublicKey: async () => {
      try {
        const key = ((await call('GET', '/v1/push/public-key')) as { publicKey?: unknown } | null)?.publicKey
        return typeof key === 'string' ? key : null
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    putSubscription: async (body) => {
      await call('PUT', '/v1/push/subscription', body, expectedUserHeader(expectedUser()))
    },
    deleteSubscription: async (endpoint) => {
      await call('DELETE', '/v1/push/subscription', { endpoint }, expectedUserHeader(expectedUser()))
    },
    sendFeedback: async (body) => {
      await call('POST', '/v1/feedback', body, expectedUserHeader(expectedUser()))
    },
  }
}
