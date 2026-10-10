import { localOrTestOrigin } from './access'
import type { Env } from './bindings'

/** The service the model is reached through when FEEDBACK_AI_URL names no other: OpenRouter. The client posts to `/chat/completions` under it. */
export const DEFAULT_AI_URL = 'https://openrouter.ai/api/v1'
/** The model asked when FEEDBACK_AI_MODEL names none: the corpus review's. */
export const DEFAULT_AI_MODEL = 'google/gemini-3.8-flash'
/** Calls to the model a UTC day when FEEDBACK_AI_DAILY_CALLS sets no other limit (spec 2026-10-10 §2 rule 7). */
export const DEFAULT_DAILY_CALLS = 200
/** The languages the coordinator reads when FEEDBACK_READS names none (spec 2026-10-10 §6). */
const DEFAULT_READS: readonly string[] = ['en', 'bg']

/** How the Worker signs in to the service: with a key sent as it is, or with a Google service account's key file, from which a token is made (googleToken.ts). */
export type AiAuth = 'key' | 'google-service-account'
/** A setting the help cannot do without, as the tab names it. */
export type AiSetting = 'FEEDBACK_AI_AUTH' | 'FEEDBACK_AI_KEY' | 'FEEDBACK_AI_URL'

export interface AiConfig {
  readonly auth: AiAuth
  /** The secret: the service's key, or the content of a service account's JSON key file. */
  readonly key: string
  readonly model: string
  /** The service's address, with no slash at its end. */
  readonly url: string
  /** The address is a stand-in on this machine, where a developer or a test runs the Worker: there alone a key file may name a token address on this machine too. */
  readonly standIn: boolean
  readonly dailyCalls: number
  /** The languages that need no translation. */
  readonly reads: readonly string[]
}

/** The limit and the languages alone, for the status when there is no key. */
export function aiLimits(env: Env): { readonly model: string; readonly dailyCalls: number; readonly reads: readonly string[] } {
  const limit = (env.FEEDBACK_AI_DAILY_CALLS ?? '').trim()
  const reads = [...new Set((env.FEEDBACK_READS ?? '').split(',').map((code) => code.trim().toLowerCase()).filter((code) => /^[a-z]{2}$/.test(code)))]
  return {
    model: (env.FEEDBACK_AI_MODEL ?? '').trim() || DEFAULT_AI_MODEL,
    dailyCalls: /^\d{1,9}$/.test(limit) ? Number(limit) : DEFAULT_DAILY_CALLS,
    reads: reads.length > 0 ? reads : DEFAULT_READS,
  }
}

/** Whether an address is OpenRouter's: what only that service knows is sent to it alone (feedbackModel.ts). */
export function isOpenRouter(url: string): boolean {
  try {
    return new URL(url).hostname === 'openrouter.ai'
  } catch {
    return false
  }
}

/** Whether a host is Google's API: a token made from a service account goes there and nowhere else. */
function googleApiHost(hostname: string): boolean {
  return hostname === 'googleapis.com' || hostname.endsWith('.googleapis.com')
}

/**
 * The service's address as it is used, or null when it is not one the secret and the messages may go to: it must be
 * https, with no name, password, query or fragment in it. Plain http is taken only for a stand-in on this machine,
 * and only where a developer or a test runs the Worker. With a key, no address is OpenRouter's. With a Google
 * service account there is no default, and the address must be on googleapis.com.
 */
function serviceUrl(env: Env, auth: AiAuth): { readonly url: string; readonly standIn: boolean } | null {
  const raw = (env.FEEDBACK_AI_URL ?? '').trim().replace(/\/+$/, '')
  if (raw === '') return auth === 'key' ? { url: DEFAULT_AI_URL, standIn: false } : null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.hostname === '' || u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '' || raw.includes('?') || raw.includes('#')) return null
  if (u.protocol === 'https:') return auth === 'key' || googleApiHost(u.hostname) ? { url: raw, standIn: false } : null
  const standIn = u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && localOrTestOrigin(env.APP_ORIGIN)
  return standIn ? { url: raw, standIn: true } : null
}

/**
 * The AI help's settings, or the first setting that keeps it from being set up: a sign-in that is not known, no
 * secret, or an address that may not be used. Nothing falls back to another choice: a sign-in written wrong never
 * sends a key file as a key, and a wrong address never sends the messages to another service.
 * A limit that is not a whole number from 0 up is the default.
 */
export function aiSetup(env: Env): { readonly config: AiConfig; readonly needs: null } | { readonly config: null; readonly needs: AiSetting } {
  const said = (env.FEEDBACK_AI_AUTH ?? '').trim()
  const auth: AiAuth | null = said === '' || said === 'key' ? 'key' : said === 'google-service-account' ? said : null
  if (auth === null) return { config: null, needs: 'FEEDBACK_AI_AUTH' }
  const key = (env.FEEDBACK_AI_KEY ?? '').trim()
  if (key === '') return { config: null, needs: 'FEEDBACK_AI_KEY' }
  const service = serviceUrl(env, auth)
  if (service === null) return { config: null, needs: 'FEEDBACK_AI_URL' }
  return { config: { auth, key, ...service, ...aiLimits(env) }, needs: null }
}

/** The AI help's settings, or null while it is not set up (aiSetup says what is missing). */
export function aiConfig(env: Env): AiConfig | null {
  return aiSetup(env).config
}
