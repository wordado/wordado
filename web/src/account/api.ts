import type { Fetch } from '../content/packs'
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
  readonly country: string | null
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
  readonly language: 'bg' | 'en'
  readonly streakNudge: boolean
}

/** Everything the app asks of the server beside sync (spec §8.6, §8.11, §11). */
export interface Api {
  sendCode(email: string): Promise<void>
  verifyCode(email: string, code: string): Promise<void>
  /** Where to send the browser for Google sign-in; the server redirects back to one of the two URLs. */
  googleUrl(callbackUrl: string, errorCallbackUrl: string): Promise<string>
  /** The signed-in learner, or null without a valid session. */
  me(): Promise<Me | null>
  /** The request's country as the host reads it, to pre-fill the age gate; null when unknown. */
  requestCountry(): Promise<string | null>
  setCountry(country: string | null): Promise<void>
  signOut(): Promise<void>
  deleteAccount(): Promise<void>
  /** The VAPID key, or null when this server sends no reminders. */
  pushPublicKey(): Promise<string | null>
  putSubscription(body: PushSubscriptionBody): Promise<void>
  deleteSubscription(endpoint: string): Promise<void>
}

/** The data export: a download the browser makes with the session cookie (spec §11). */
export const EXPORT_URL = '/v1/export'

const codeOf = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) return null
  const { error, code } = body as { error?: unknown; code?: unknown }
  return typeof error === 'string' ? error : typeof code === 'string' ? code : null
}

/**
 * The app's calls to its own origin: `/api/auth` (Better Auth) and `/v1` (plan 5), with the session cookie.
 * `expectedUser` names the recorded learner on the push-subscription calls, so a session that is
 * someone else's is refused (409) rather than handed this device's reminders.
 */
export function httpApi(fetchFn: Fetch = (input, init) => fetch(input, init), expectedUser: () => string | null = () => null): Api {
  async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<unknown> {
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
    return parsed
  }

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
    googleUrl: async (callbackUrl, errorCallbackUrl) => {
      const body = await call('POST', '/api/auth/sign-in/social', {
        provider: 'google',
        callbackURL: callbackUrl,
        errorCallbackURL: errorCallbackUrl,
        disableRedirect: true,
      })
      const url = (body as { url?: unknown } | null)?.url
      if (typeof url !== 'string') throw new ApiError(502, 'no_redirect')
      return url
    },
    me: () => unauthorizedAsNull(call('GET', '/v1/me') as Promise<Me>),
    requestCountry: async () => {
      const country = ((await call('GET', '/v1/country')) as { country?: unknown } | null)?.country
      return typeof country === 'string' ? country : null
    },
    setCountry: async (country) => {
      await call('POST', '/api/auth/update-user', { country })
    },
    signOut: async () => {
      await call('POST', '/api/auth/sign-out', {})
    },
    deleteAccount: async () => {
      await call('DELETE', '/v1/account', { confirm: true })
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
  }
}
