import { describe, expect, it } from 'vitest'
import type { AiConfig } from './feedbackAiConfig'
import { askModel, MODEL_TIMEOUT_MS, type ModelRequest } from './feedbackModel'
import { FakeModel } from './test/fakeModel'
import { fetchBy } from './test/platform'

const KEY = 'k'.repeat(40)
const config: AiConfig = { key: KEY, model: 'test/model', url: 'https://model.test/api/v1/chat/completions', dailyCalls: 200, reads: ['en', 'bg'] }
const SECRET_TEXT = 'Der Ton wird zweimal abgespielt.'
const req: ModelRequest = {
  name: 'feedback_messages',
  system: 'Describe each message.',
  input: { messages: [{ id: 1, text: SECRET_TEXT }] },
  schema: { type: 'object', additionalProperties: false, required: ['results'], properties: { results: { type: 'array' } } },
}

function setup() {
  const model = new FakeModel(KEY)
  const logged: string[] = []
  const inits: (RequestInit | undefined)[] = []
  const deps = { fetch: async (input: string, init?: RequestInit) => (inits.push(init), model.fetch(input, init)), log: (line: string) => void logged.push(line) }
  return { model, logged, inits, deps }
}

describe('askModel', () => {
  it('makes one request: the instructions, the input as JSON in the user message, the schema held strictly, no provider that keeps data', async () => {
    const { model, deps, inits, logged } = setup()
    model.answer = () => ({ results: [{ id: 1 }] })
    expect(await askModel(deps, config, req)).toEqual({ ok: true, value: { results: [{ id: 1 }] } })
    expect(model.requests).toHaveLength(1)
    const sent = model.requests[0]!
    expect(sent.url).toBe(config.url)
    expect(sent.headers).toMatchObject({ authorization: `Bearer ${KEY}`, 'content-type': 'application/json', 'http-referer': 'https://wordado.com', 'x-title': 'Wordado feedback' })
    expect(sent.body).toEqual({
      model: 'test/model',
      messages: [
        { role: 'system', content: 'Describe each message.' },
        { role: 'user', content: JSON.stringify(req.input) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'feedback_messages', strict: true, schema: req.schema } },
      provider: { require_parameters: true, data_collection: 'deny' },
    })
    expect(model.inputOf(0)).toEqual(req.input)
    expect(inits[0]?.method).toBe('POST')
    expect(inits[0]?.redirect).toBe('manual')
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(logged).toEqual([])
  })

  it('gives the model twenty seconds', async () => {
    expect(MODEL_TIMEOUT_MS).toBe(20_000)
    // A service that never answers: the request is given up when its time is over.
    const logged: string[] = []
    const never = (_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason as Error)))
    const started = Date.now()
    expect(await askModel({ fetch: never, log: (line) => void logged.push(line) }, config, req, 40)).toEqual({ ok: false, why: 'late' })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(logged).toEqual(['feedback AI: late (TimeoutError)'])
  })

  it('says late when the time is over, and unreachable when the service is not reached', async () => {
    const { model, deps, logged } = setup()
    model.failure = 'late'
    expect(await askModel(deps, config, req)).toEqual({ ok: false, why: 'late' })
    model.failure = new TypeError(`connect failed for Bearer ${KEY} with ${SECRET_TEXT}`)
    expect(await askModel(deps, config, req)).toEqual({ ok: false, why: 'unreachable' })
    expect(logged).toEqual(['feedback AI: late (TimeoutError)', 'feedback AI: unreachable (TypeError)'])
    // One request each: there is no second try.
    expect(model.requests).toHaveLength(2)
  })

  it('says unreachable to 429 and to a status from 500 up, and refused to any other that is not 200', async () => {
    const { model, deps, logged } = setup()
    for (const [status, why] of [[429, 'unreachable'], [500, 'unreachable'], [503, 'unreachable'], [400, 'refused'], [401, 'refused'], [403, 'refused'], [302, 'refused'], [204, 'refused']] as const) {
      model.failure = { status }
      expect(await askModel(deps, config, req)).toEqual({ ok: false, why })
      expect(logged.at(-1)).toBe(`feedback AI: ${why} (${status})`)
    }
    expect(model.requests).toHaveLength(8)
  })

  it('refuses a wrong key like the service does', async () => {
    const { model, deps } = setup()
    expect(await askModel(deps, { ...config, key: 'another' }, req)).toEqual({ ok: false, why: 'refused' })
    expect(model.requests).toHaveLength(1)
  })

  it('says unfit to a body that is not JSON, has no message content, or whose content is not JSON', async () => {
    const { model, deps, logged } = setup()
    for (const body of ['<html>', '', '{}', '{"choices":[]}', '{"choices":[{"message":{"content":7}}]}', '{"choices":[{"message":{"content":"{\\"results\\": [tru"}}]}', 'null']) {
      model.failure = { status: 200, body }
      expect(await askModel(deps, config, req)).toEqual({ ok: false, why: 'unfit' })
    }
    expect(logged).toHaveLength(7)
    for (const line of logged) expect(line).toMatch(/^feedback AI: unfit \((not JSON|no content|content not JSON)\)$/)
  })

  it('logs nothing of the request, of the answer or of the key, whatever went wrong', async () => {
    const { model, deps, logged } = setup()
    // The service echoes what it was sent, as an error body may.
    model.failure = { status: 400 }
    await askModel(deps, config, req)
    model.failure = { status: 500 }
    await askModel(deps, config, req)
    model.failure = { status: 200, body: `not json: ${SECRET_TEXT} ${KEY}` }
    await askModel(deps, config, req)
    model.failure = { status: 200, body: JSON.stringify({ choices: [{ message: { content: `${SECRET_TEXT} ${KEY}` } }] }) }
    await askModel(deps, config, req)
    const named = new Error('x')
    named.name = `${SECRET_TEXT} ${KEY}`
    model.failure = named
    await askModel(deps, config, req)
    expect(logged).toHaveLength(5)
    const all = logged.join('\n')
    expect(all).not.toContain(KEY)
    expect(all).not.toContain('Ton')
    expect(all).not.toContain('Describe')
    expect(logged.at(-1)).toBe('feedback AI: unreachable (error)')
  })

  it('never throws, even when the answer cannot be read to its end', async () => {
    const logged: string[] = []
    const broken = async () => ({ status: 200, text: () => Promise.reject(new TypeError('the stream broke')) }) as unknown as Response
    expect(await askModel({ fetch: broken, log: (line) => void logged.push(line) }, config, req)).toEqual({ ok: false, why: 'unreachable' })
  })
})

describe('fetchBy', () => {
  it('sends a request to the fake of its origin, and answers 599 to any other', async () => {
    const model = new FakeModel(KEY)
    const fetch = fetchBy({ 'https://model.test': model.fetch })
    expect((await fetch('https://model.test/api/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: JSON.stringify({ messages: [{ role: 'user', content: '{}' }], response_format: { json_schema: { name: 'x' } } }) })).status).toBe(200)
    expect((await fetch('https://elsewhere.test/api')).status).toBe(599)
    expect(model.requests).toHaveLength(1)
  })
})
