import type { Deps } from './app'
import { isOpenRouter, PROJECT_PLACEHOLDER, type AiConfig } from './feedbackAiConfig'
import { forgetGoogleToken, googleToken, nameOf } from './googleToken'

/** How long the model has to answer (spec 2026-10-10 §7): the token, when one must be made first, and the model's answer together. */
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

/**
 * One call to the model, once, with no second try: a handler may make few requests and has 20 seconds.
 * The request is the one every service of this kind takes (`POST {address}/chat/completions`, the answer held to a
 * JSON schema), so another service is a change of settings. What only OpenRouter knows goes to OpenRouter alone.
 * Signed in with a Google service account, a token is made first when none is kept (googleToken.ts): one more
 * request, inside the same 20 seconds. `{project}` in the address is then the key file's `project_id`.
 * The answer is JSON held to `schema` by the service; the caller checks it again. Never throws. What is logged of a
 * failure is the step (`key file`, `token` or `model`) and a status or an error's name: never the request, the
 * answer, the key, the key file, the signed JWT or the token.
 */
export async function askModel(deps: Pick<Deps, 'fetch' | 'log' | 'now'>, config: AiConfig, req: ModelRequest, timeoutMs = MODEL_TIMEOUT_MS): Promise<ModelAnswer> {
  const failed = (why: 'unreachable' | 'late' | 'refused' | 'unfit', detail: string): ModelAnswer => {
    deps.log(`feedback AI: ${why} (${detail})`)
    return { ok: false, why }
  }
  // One clock for everything this call sends.
  const signal = AbortSignal.timeout(timeoutMs)
  let bearer = config.key
  let url = config.url
  if (config.auth === 'google-service-account') {
    // The project can be left out of the address, which is written in a public file: `{project}` is the key file's.
    const needsProject = url.includes(PROJECT_PLACEHOLDER)
    const token = await googleToken(deps, config.key, { standIn: config.standIn, needsProject, signal })
    if (!token.ok) return failed(token.why, token.detail)
    bearer = token.token
    if (needsProject && token.projectId !== null) url = url.replaceAll(PROJECT_PLACEHOLDER, token.projectId)
  }
  // OpenRouter passes a request on to a provider: it is told who asks, and that no provider that keeps what it is
  // sent may serve the request. Another service does not know these words, and gets none of them.
  const openRouter = isOpenRouter(config.url)
  let text: string
  try {
    // A redirect is not followed: the key and the messages go to the service they were meant for and nowhere else.
    const res = await deps.fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', ...(openRouter ? { 'http-referer': 'https://wordado.com', 'x-title': 'Wordado feedback' } : {}) },
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
      signal,
    })
    // A token the service no longer takes is not kept for the next call.
    if (res.status === 401 && config.auth === 'google-service-account') forgetGoogleToken()
    if (res.status === 429 || res.status >= 500) return failed('unreachable', `model: ${res.status}`)
    if (res.status !== 200) return failed('refused', `model: ${res.status}`)
    text = await res.text()
  } catch (err) {
    const name = nameOf(err)
    return failed(name === 'TimeoutError' ? 'late' : 'unreachable', `model: ${name}`)
  }
  let body: { choices?: { message?: { content?: unknown } }[] } | null
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    return failed('unfit', 'model: not JSON')
  }
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return failed('unfit', 'model: no content')
  try {
    return { ok: true, value: JSON.parse(content) as unknown }
  } catch {
    return failed('unfit', 'model: content not JSON')
  }
}
