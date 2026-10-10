import type { Deps } from './app'
import { isOpenRouter, type AiConfig } from './feedbackAiConfig'

/** How long the model has to answer (spec 2026-10-10 §7). */
export const MODEL_TIMEOUT_MS = 20_000

/** One question to the model: the instructions, the input (sent as JSON, in a message of its own) and the schema the answer is held to. */
export interface ModelRequest {
  /** The schema's name. */
  readonly name: string
  readonly system: string
  readonly input: unknown
  readonly schema: Readonly<Record<string, unknown>>
}

/** The model's answer as JSON, or why there is none: not reached, late, refused by the service, or not an answer that can be read. */
export type ModelAnswer = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly why: 'unreachable' | 'late' | 'refused' | 'unfit' }

/** The name of what was thrown, when it is a plain word: a name is logged, a message never (it can hold part of the request). */
function nameOf(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name
  return typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name) ? name : 'error'
}

/**
 * One call to the model, once, with no second try: a handler may make few requests and has 20 seconds.
 * The request is the one every service of this kind takes (`POST {address}/chat/completions`, the answer held to a
 * JSON schema), so another service is a change of settings. What only OpenRouter knows goes to OpenRouter alone.
 * The answer is JSON held to `schema` by the service; the caller checks it again. Never throws. What is logged of a
 * failure is a status or an error's name: never the request, the answer or the key.
 */
export async function askModel(deps: Pick<Deps, 'fetch' | 'log'>, config: AiConfig, req: ModelRequest, timeoutMs = MODEL_TIMEOUT_MS): Promise<ModelAnswer> {
  const failed = (why: 'unreachable' | 'late' | 'refused' | 'unfit', detail: string | number): ModelAnswer => {
    deps.log(`feedback AI: ${why} (${detail})`)
    return { ok: false, why }
  }
  // OpenRouter passes a request on to a provider: it is told who asks, and that no provider that keeps what it is
  // sent may serve the request. Another service does not know these words, and gets none of them.
  const openRouter = isOpenRouter(config.url)
  let text: string
  try {
    // A redirect is not followed: the key and the messages go to the service they were meant for and nowhere else.
    const res = await deps.fetch(`${config.url}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.key}`, 'content-type': 'application/json', ...(openRouter ? { 'http-referer': 'https://wordado.com', 'x-title': 'Wordado feedback' } : {}) },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: JSON.stringify(req.input) },
        ],
        response_format: { type: 'json_schema', json_schema: { name: req.name, strict: true, schema: req.schema } },
        ...(openRouter ? { provider: { require_parameters: true, data_collection: 'deny' } } : {}),
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 429 || res.status >= 500) return failed('unreachable', res.status)
    if (res.status !== 200) return failed('refused', res.status)
    text = await res.text()
  } catch (err) {
    const name = nameOf(err)
    return failed(name === 'TimeoutError' ? 'late' : 'unreachable', name)
  }
  let body: { choices?: { message?: { content?: unknown } }[] } | null
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    return failed('unfit', 'not JSON')
  }
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return failed('unfit', 'no content')
  try {
    return { ok: true, value: JSON.parse(content) as unknown }
  } catch {
    return failed('unfit', 'content not JSON')
  }
}
