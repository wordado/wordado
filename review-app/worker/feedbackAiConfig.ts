import { localOrTestOrigin } from './access'
import type { Env } from './bindings'

/** Where the model is reached: OpenRouter's chat completions. */
export const MODEL_URL = 'https://openrouter.ai/api/v1/chat/completions'
/** The model asked when FEEDBACK_AI_MODEL names none: the corpus review's. */
export const DEFAULT_AI_MODEL = 'google/gemini-3.8-flash'
/** Calls to the model a UTC day when FEEDBACK_AI_DAILY_CALLS sets no other limit (spec 2026-10-10 §2 rule 7). */
export const DEFAULT_DAILY_CALLS = 200
/** The languages the coordinator reads when FEEDBACK_READS names none (spec 2026-10-10 §6). */
const DEFAULT_READS: readonly string[] = ['en', 'bg']

export interface AiConfig {
  readonly key: string
  readonly model: string
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

/** The AI help's settings, or null while there is no key. A limit that is not a whole number from 0 up is the default. */
export function aiConfig(env: Env): AiConfig | null {
  const key = (env.FEEDBACK_AI_KEY ?? '').trim()
  if (key === '') return null
  // A stand-in model's address counts only where a developer or a test runs the Worker: anywhere else the key and
  // the messages go to the real service and nowhere else, even if the setting were ever there.
  const standIn = (env.FEEDBACK_AI_URL ?? '').trim()
  return { key, url: standIn !== '' && localOrTestOrigin(env.APP_ORIGIN) ? standIn : MODEL_URL, ...aiLimits(env) }
}
