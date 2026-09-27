/** One structured request: the stage's instructions, its input as JSON, and the schema the answer must follow. */
export interface LlmRequest<T> {
  /** The schema's name; also names the stage in errors. */
  readonly name: string
  readonly system: string
  readonly input: unknown
  readonly schema: Readonly<Record<string, unknown>>
  /** Checks the answer beyond the schema (the right items, in the right order); throws ParseError. */
  readonly parse: (value: unknown) => T
}

/** The LLM port (spec §17: every vendor sits behind an interface). */
export interface Llm {
  json<T>(req: LlmRequest<T>): Promise<T>
  readonly model: string
  spentUsd(): number
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmError'
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}

export class BudgetExceeded extends Error {
  constructor(spent: number, max: number) {
    super(`LLM spend reached $${spent.toFixed(2)} of this run's $${max.toFixed(2)} (llm.max_usd_per_run); rerun to continue from the cache`)
    this.name = 'BudgetExceeded'
  }
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const ATTEMPTS = 4

class Retryable extends Error {}

export interface OpenRouterOptions {
  readonly apiKey: string
  readonly model: string
  readonly maxUsd: number
  readonly fetch?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
}

/**
 * OpenRouter's chat completions with strict `json_schema` output (§17.1).
 * `require_parameters` keeps the request off providers that would ignore the
 * schema; `data_collection: "deny"` keeps it off providers that train on it.
 * Rate limits, server errors, network failures and answers that do not parse
 * are retried with backoff; any other client error is not.
 */
export function openRouterLlm(opts: OpenRouterOptions): Llm {
  const doFetch = opts.fetch ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let spent = 0

  async function attempt<T>(req: LlmRequest<T>): Promise<T> {
    let res: Response
    try {
      res = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          'content-type': 'application/json',
          'http-referer': 'https://wordado.com',
          'x-title': 'Wordado corpus pipeline',
        },
        body: JSON.stringify({
          model: opts.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: JSON.stringify(req.input) },
          ],
          response_format: { type: 'json_schema', json_schema: { name: req.name, strict: true, schema: req.schema } },
          provider: { require_parameters: true, data_collection: 'deny' },
        }),
      })
    } catch (err) {
      throw new Retryable(`network: ${err instanceof Error ? err.message : String(err)}`)
    }
    const text = await res.text()
    if (res.status === 429 || res.status >= 500) throw new Retryable(`HTTP ${res.status}`)
    if (!res.ok) throw new LlmError(`${req.name}: HTTP ${res.status}: ${text.slice(0, 500)}`)
    let body: { choices?: { message?: { content?: unknown } }[]; usage?: { cost?: unknown } }
    try {
      body = JSON.parse(text) as typeof body
    } catch {
      throw new Retryable('the response body is not JSON')
    }
    if (typeof body.usage?.cost === 'number') spent += body.usage.cost
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Retryable('the response has no message content')
    let value: unknown
    try {
      value = JSON.parse(content)
    } catch {
      throw new Retryable('the answer is not JSON (truncated?)')
    }
    try {
      return req.parse(value)
    } catch (err) {
      if (err instanceof ParseError) throw new Retryable(`the answer does not fit: ${err.message}`)
      throw err
    }
  }

  return {
    model: opts.model,
    spentUsd: () => spent,
    async json<T>(req: LlmRequest<T>): Promise<T> {
      let last = ''
      for (let i = 0; i < ATTEMPTS; i += 1) {
        if (spent >= opts.maxUsd) throw new BudgetExceeded(spent, opts.maxUsd)
        try {
          return await attempt(req)
        } catch (err) {
          if (!(err instanceof Retryable)) throw err
          last = err.message
          if (i < ATTEMPTS - 1) await sleep(1000 * 2 ** i)
        }
      }
      throw new LlmError(`${req.name}: gave up after ${ATTEMPTS} attempts: ${last}`)
    },
  }
}

/** A deterministic LLM for tests: `answer` gets the request's name and input and returns the parsed-JSON answer. */
export function fakeLlm(answer: (name: string, input: unknown) => unknown): Llm & { readonly calls: { name: string; input: unknown }[] } {
  const calls: { name: string; input: unknown }[] = []
  return {
    model: 'fake',
    calls,
    spentUsd: () => 0,
    async json<T>(req: LlmRequest<T>): Promise<T> {
      calls.push({ name: req.name, input: req.input })
      return req.parse(JSON.parse(JSON.stringify(answer(req.name, req.input))))
    },
  }
}
