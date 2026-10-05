import { AnswerDoesNotFit, LlmError, ParseError, type Llm, type LlmRequest } from './llm'

const ATTEMPTS = 4

/**
 * A model served by a local OpenAI-compatible server (llama.cpp's llama-server, Ollama, vLLM): no key, no spend.
 * The answer is held to the schema by `response_format`, sent in both the llama.cpp shape (`schema`) and the
 * OpenAI shape (`json_schema.schema`). A server that does not answer fails the run at once.
 */
export function localLlm(opts: { url: string; model: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Llm {
  const doFetch = opts.fetch ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const endpoint = `${opts.url.replace(/\/+$/, '')}/v1/chat/completions`
  return {
    model: `local:${opts.model}`,
    spentUsd: () => 0,
    async json<T>(req: LlmRequest<T>): Promise<T> {
      let last = ''
      for (let i = 0; i < ATTEMPTS; i += 1) {
        let res: Response
        try {
          res = await doFetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              model: opts.model,
              messages: [
                { role: 'system', content: req.system },
                { role: 'user', content: JSON.stringify(req.input) },
              ],
              response_format: { type: 'json_schema', schema: req.schema, json_schema: { name: req.name, schema: req.schema } },
              temperature: 0.1,
            }),
          })
        } catch (err) {
          throw new LlmError(`${req.name}: no server answers at ${opts.url} (${err instanceof Error ? err.message : String(err)}); start it first`)
        }
        if (!res.ok) throw new LlmError(`${req.name}: ${opts.url} answered HTTP ${res.status}`)
        const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
        const content = body.choices?.[0]?.message?.content
        try {
          if (typeof content !== 'string') throw new ParseError('the response has no message content')
          let value: unknown
          try {
            value = JSON.parse(content)
          } catch {
            throw new ParseError('the answer is not JSON')
          }
          return req.parse(value)
        } catch (err) {
          if (!(err instanceof ParseError)) throw err
          last = err.message
          if (i < ATTEMPTS - 1) await sleep(500 * 2 ** i)
        }
      }
      throw new AnswerDoesNotFit(`${req.name}: gave up after ${ATTEMPTS} attempts: the answer does not fit: ${last}`)
    },
  }
}
