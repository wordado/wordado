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

export interface AiConfig {
  readonly key: string
  readonly model: string
  /** The service's address, with no slash at its end. */
  readonly url: string
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

/**
 * The service's address as it is used, or null when it is not one the key and the messages may go to: it must be
 * https, with no name, password, query or fragment in it. Plain http is taken only for a stand-in on this machine,
 * and only where a developer or a test runs the Worker.
 */
function serviceUrl(env: Env): string | null {
  const raw = (env.FEEDBACK_AI_URL ?? '').trim().replace(/\/+$/, '')
  if (raw === '') return DEFAULT_AI_URL
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.hostname === '' || u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '' || raw.includes('?') || raw.includes('#')) return null
  if (u.protocol === 'https:') return raw
  const standIn = u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && localOrTestOrigin(env.APP_ORIGIN)
  return standIn ? raw : null
}

/**
 * The AI help's settings, or null while it is not set up: there is no key, or FEEDBACK_AI_URL is not an address
 * that may be used. A wrong address never falls back to another service: the owner chose where the messages go.
 * A limit that is not a whole number from 0 up is the default.
 */
export function aiConfig(env: Env): AiConfig | null {
  const key = (env.FEEDBACK_AI_KEY ?? '').trim()
  const url = serviceUrl(env)
  if (key === '' || url === null) return null
  return { key, url, ...aiLimits(env) }
}
