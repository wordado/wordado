import type { FeedbackInput, InterfaceLanguage, NewsConsent } from '@wordado/core'
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
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

/** The learner cancelled the device prompt, or the browser abandoned the request (`NotAllowedError`, `AbortError`). Not a failure to report. */
export class PasskeyCancelled extends Error {
  constructor() {
    super('The passkey prompt was cancelled')
    this.name = 'PasskeyCancelled'
  }
}

/** A passkey of the account as the settings list it (#287): nothing but whose it is and when it was made. */
export interface PasskeyInfo {
  readonly id: string
  /** The credential ID (base64url, not secret): what the browser is told when the passkey is gone from the server. */
  readonly credentialId: string
  readonly createdAt: number
}

/** `GET /v1/me` (plan 5). */
export interface Me {
  readonly userId: string
  readonly email: string
  readonly createdAt: number
  /** News by email (#186): whether the learner said yes, took it back, or was never asked. */
  readonly newsConsent: NewsConsent
  /** The interface language the server was last told for the account (#199); null before any app told it. */
  readonly interfaceLanguage: InterfaceLanguage | null
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

/**
 * What a right code leads to (#293): an address with an account is signed in; one without gets a ticket, the
 * server's proof that the code was right, with which the age step creates the account without a second code.
 */
export type CodeOutcome = { readonly kind: 'signed-in' } | { readonly kind: 'new-account'; readonly ticket: string }

/** Everything the app asks of the server beside sync (spec §8.6, §8.11, §8.12, §11). */
export interface Api {
  sendCode(email: string): Promise<void>
  /** Checks the code: signs in to the address's account, or says it has none yet (#293). A returning sign-in sends no consent to news (#186). */
  verifyCode(email: string, code: string): Promise<CodeOutcome>
  /**
   * After the age step, confirmed (spec §11): creates the account with the ticket and signs in. `newsConsent` is the
   * wording of the news box when the learner ticked it (#186), recorded with the account.
   */
  createAccount(email: string, ticket: string, newsConsent: string | null): Promise<void>
  /** The age step not confirmed, or another address chosen: the server drops the ticket and creates nothing. Never fails. */
  discardSignUp(email: string, ticket: string): Promise<void>
  /** The signed-in learner, or null without a valid session. */
  me(): Promise<Me | null>
  /** The request's country as the host reads it, to pre-fill the age gate; null when unknown. */
  requestCountry(): Promise<string | null>
  signOut(): Promise<void>
  deleteAccount(): Promise<void>
  /** The news switch (#186), for the recorded learner only: `text` is the wording on it, recorded when the consent is given. Answers what the server now holds. */
  setNewsConsent(consent: boolean, text: string): Promise<NewsConsent>
  /** Tells the server the interface language (#199), for the recorded learner only. Answers what the server now holds. */
  setInterfaceLanguage(language: InterfaceLanguage): Promise<InterfaceLanguage>
  /** The data export, for the recorded learner only (409 when the session is someone else's). */
  exportData(): Promise<ExportFile>
  /** The VAPID key, or null when this server sends no reminders. */
  pushPublicKey(): Promise<string | null>
  putSubscription(body: PushSubscriptionBody): Promise<void>
  deleteSubscription(endpoint: string): Promise<void>
  /** Feedback about the app, signed in or not: with a session the server attaches the account. */
  sendFeedback(body: FeedbackBody): Promise<void>
  /**
   * Adds a passkey to the signed-in account (#287): the device asks for its unlock. Throws `PasskeyCancelled` when
   * the learner declines, `ApiError` with status 403 when the session is older than a day (sign in again first).
   */
  passkeyRegister(): Promise<void>
  /**
   * Signs in with a passkey, no email needed (#287). `conditional` waits in the email field's autofill list until the
   * learner picks one; `signal` aborts it. Throws `PasskeyCancelled`, or `ApiError` (code `PASSKEY_NOT_FOUND`: removed).
   */
  passkeySignIn(options: { conditional: boolean; signal?: AbortSignal }): Promise<void>
  /** The account's passkeys, oldest first. */
  listPasskeys(): Promise<readonly PasskeyInfo[]>
  deletePasskey(id: string): Promise<void>
  /**
   * Tells the browser a passkey is gone from the server, so it stops offering it (#287). Only where the browser can
   * (`signalUnknownCredential`); never throws.
   */
  signalGone(credentialId: string): Promise<void>
}

const codeOf = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) return null
  const { error, code } = body as { error?: unknown; code?: unknown }
  return typeof error === 'string' ? error : typeof code === 'string' ? code : null
}

const isCancel = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false
  const { name, code, cause } = err as { name?: unknown; code?: unknown; cause?: unknown }
  const causeName = typeof cause === 'object' && cause !== null ? (cause as { name?: unknown }).name : undefined
  return [name, causeName].some((n) => n === 'NotAllowedError' || n === 'AbortError') || code === 'ERROR_CEREMONY_ABORTED'
}

/** Runs a browser ceremony, turning the learner's cancellation into `PasskeyCancelled`. */
const ceremony = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (err) {
    throw isCancel(err) ? new PasskeyCancelled() : err
  }
}

/**
 * The app's calls to its own origin: `/api/auth` (Better Auth) and `/v1` (plan 5), with the session cookie.
 * `expectedUser` names the recorded learner on the push-subscription calls, the account deletion, the news
 * switch, the interface language and the export, so a session that is someone else's is refused (409) rather than acted on; on feedback,
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
      const { response, parsed } = await request('POST', '/api/auth/sign-in/email-otp', { email, otp: code })
      const { code: answer, ticket } = (parsed ?? {}) as { code?: unknown; ticket?: unknown }
      if (response.status === 202 && answer === 'NEW_ACCOUNT' && typeof ticket === 'string') return { kind: 'new-account', ticket }
      if (response.status !== 200) throw new ApiError(response.status, codeOf(parsed))
      return { kind: 'signed-in' }
    },
    createAccount: async (email, ticket, newsConsent) => {
      await call('POST', '/api/auth/email-otp/create-account', { email, ticket, ageConfirmed: true, ...(newsConsent === null ? {} : { newsConsent }) })
    },
    discardSignUp: async (email, ticket) => {
      try {
        await call('POST', '/api/auth/email-otp/create-account', { email, ticket, ageConfirmed: false })
      } catch {
        // The answer is a refusal by design (403), and a ticket left behind lapses within minutes on its own.
      }
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
    setNewsConsent: async (consent, text) => {
      const body = consent ? { consent, text } : { consent }
      return ((await call('PUT', '/v1/account/news-consent', body, expectedUserHeader(expectedUser()))) as { newsConsent: NewsConsent }).newsConsent
    },
    setInterfaceLanguage: async (language) =>
      ((await call('PUT', '/v1/account/interface-language', { language }, expectedUserHeader(expectedUser()))) as { interfaceLanguage: InterfaceLanguage }).interfaceLanguage,
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
    passkeyRegister: async () => {
      const optionsJSON = (await call('GET', '/api/auth/passkey/generate-register-options')) as PublicKeyCredentialCreationOptionsJSON
      const { startRegistration } = await import('@simplewebauthn/browser')
      const response = await ceremony(() => startRegistration({ optionsJSON }))
      await call('POST', '/api/auth/passkey/verify-registration', { response })
    },
    passkeySignIn: async ({ conditional, signal }) => {
      const options = (await call('GET', '/api/auth/passkey/generate-authenticate-options')) as PublicKeyCredentialRequestOptionsJSON
      // The plugin only asks for 'preferred'; the server refuses a response without the device unlock.
      const optionsJSON = { ...options, userVerification: 'required' as const }
      const { startAuthentication, WebAuthnAbortService } = await import('@simplewebauthn/browser')
      const onAbort = () => WebAuthnAbortService.cancelCeremony()
      if (signal?.aborted) throw new PasskeyCancelled()
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const response = await ceremony(() => startAuthentication({ optionsJSON, useBrowserAutofill: conditional }))
        await call('POST', '/api/auth/passkey/verify-authentication', { response })
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    },
    listPasskeys: async () => {
      const rows = (await call('GET', '/api/auth/passkey/list-user-passkeys')) as readonly { id: string; credentialID: string; createdAt: string | number }[] | null
      return (rows ?? [])
        .map((row) => ({ id: row.id, credentialId: row.credentialID, createdAt: new Date(row.createdAt).getTime() }))
        .sort((a, b) => a.createdAt - b.createdAt)
    },
    deletePasskey: async (id) => {
      await call('POST', '/api/auth/passkey/delete-passkey', { id })
    },
    signalGone: async (credentialId) => {
      try {
        const signal = (globalThis.PublicKeyCredential as unknown as { signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void> } | undefined)
          ?.signalUnknownCredential
        if (typeof signal !== 'function') return
        const { rpId } = (await call('GET', '/api/auth/passkey/generate-authenticate-options')) as { rpId?: unknown }
        if (typeof rpId !== 'string') return
        await signal.call(globalThis.PublicKeyCredential, { rpId, credentialId })
      } catch {
        // A hint to the browser, nothing more.
      }
    },
  }
}
