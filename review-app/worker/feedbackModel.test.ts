import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AiConfig } from './feedbackAiConfig'
import { askModel, MODEL_TIMEOUT_MS, type ModelRequest } from './feedbackModel'
import { forgetGoogleToken, TOKEN_MARGIN_S } from './googleToken'
import { FakeModel, testServiceAccount, type TestServiceAccount } from './test/fakeModel'
import { fetchBy } from './test/platform'

const KEY = 'k'.repeat(40)
const config: AiConfig = { auth: 'key', key: KEY, model: 'test/model', url: 'https://model.test/api/v1', standIn: false, dailyCalls: 200, reads: ['en', 'bg'] }
const NOW = new Date('2026-10-05T12:00:00Z')
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
  const deps = { fetch: async (input: string, init?: RequestInit) => (inits.push(init), model.fetch(input, init)), log: (line: string) => void logged.push(line), now: () => NOW }
  return { model, logged, inits, deps }
}

describe('askModel', () => {
  it('makes one request, in the way every service of this kind takes it: the instructions, the input as JSON in the user message, the schema held strictly', async () => {
    const { model, deps, inits, logged } = setup()
    model.answer = () => ({ results: [{ id: 1 }] })
    expect(await askModel(deps, config, req)).toEqual({ ok: true, value: { results: [{ id: 1 }] } })
    expect(model.requests).toHaveLength(1)
    const sent = model.requests[0]!
    expect(sent.url).toBe('https://model.test/api/v1/chat/completions')
    expect(sent.headers).toEqual({ authorization: `Bearer ${KEY}`, 'content-type': 'application/json' })
    expect(sent.body).toEqual({
      model: 'test/model',
      messages: [
        { role: 'system', content: 'Describe each message.' },
        { role: 'user', content: JSON.stringify(req.input) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'feedback_messages', strict: true, schema: req.schema } },
    })
    expect(model.inputOf(0)).toEqual(req.input)
    expect(inits[0]?.method).toBe('POST')
    expect(inits[0]?.redirect).toBe('manual')
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(logged).toEqual([])
  })

  it('adds what only OpenRouter knows when the address is OpenRouter’s: who asks, and no provider that keeps what it is sent', async () => {
    const { model, deps } = setup()
    expect((await askModel(deps, { ...config, url: 'https://openrouter.ai/api/v1' }, req)).ok).toBe(true)
    const sent = model.requests[0]!
    expect(sent.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(sent.headers).toEqual({ authorization: `Bearer ${KEY}`, 'content-type': 'application/json', 'http-referer': 'https://wordado.com', 'x-title': 'Wordado feedback' })
    expect(sent.body.provider).toEqual({ require_parameters: true, data_collection: 'deny' })
    // Everything else is the same request.
    const { provider: _provider, ...rest } = sent.body
    await askModel(deps, config, req)
    expect(model.requests[1]!.body).toEqual(rest)
    expect('provider' in model.requests[1]!.body).toBe(false)
  })

  it('gives the model twenty seconds', async () => {
    expect(MODEL_TIMEOUT_MS).toBe(20_000)
    // A service that never answers: the request is given up when its time is over.
    const logged: string[] = []
    const never = (_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason as Error)))
    const started = Date.now()
    expect(await askModel({ fetch: never, log: (line) => void logged.push(line), now: () => NOW }, config, req, 40)).toEqual({ ok: false, why: 'late' })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(logged).toEqual(['feedback AI: late (model: TimeoutError)'])
  })

  it('says late when the time is over, and unreachable when the service is not reached', async () => {
    const { model, deps, logged } = setup()
    model.failure = 'late'
    expect(await askModel(deps, config, req)).toEqual({ ok: false, why: 'late' })
    model.failure = new TypeError(`connect failed for Bearer ${KEY} with ${SECRET_TEXT}`)
    expect(await askModel(deps, config, req)).toEqual({ ok: false, why: 'unreachable' })
    expect(logged).toEqual(['feedback AI: late (model: TimeoutError)', 'feedback AI: unreachable (model: TypeError)'])
    // One request each: there is no second try.
    expect(model.requests).toHaveLength(2)
  })

  it('says unreachable to 429 and to a status from 500 up, and refused to any other that is not 200', async () => {
    const { model, deps, logged } = setup()
    for (const [status, why] of [[429, 'unreachable'], [500, 'unreachable'], [503, 'unreachable'], [400, 'refused'], [401, 'refused'], [403, 'refused'], [302, 'refused'], [204, 'refused']] as const) {
      model.failure = { status }
      expect(await askModel(deps, config, req)).toEqual({ ok: false, why })
      expect(logged.at(-1)).toBe(`feedback AI: ${why} (model: ${status})`)
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
    for (const line of logged) expect(line).toMatch(/^feedback AI: unfit \(model: (not JSON|no content|content not JSON)\)$/)
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
    expect(logged.at(-1)).toBe('feedback AI: unreachable (model: error)')
  })

  it('never throws, even when the answer cannot be read to its end', async () => {
    const logged: string[] = []
    const broken = async () => ({ status: 200, text: () => Promise.reject(new TypeError('the stream broke')) }) as unknown as Response
    expect(await askModel({ fetch: broken, log: (line) => void logged.push(line), now: () => NOW }, config, req)).toEqual({ ok: false, why: 'unreachable' })
  })
})

describe('askModel, signed in with a Google service account', () => {
  const VERTEX = 'https://aiplatform.eu.rep.googleapis.com/v1/projects/a-project/locations/eu/endpoints/openapi'
  let account: TestServiceAccount
  let google: AiConfig
  beforeAll(async () => {
    account = await testServiceAccount()
    google = { auth: 'google-service-account', key: account.keyFile, model: 'google/test-model', url: VERTEX, standIn: false, dailyCalls: 200, reads: ['en', 'bg'] }
  })
  beforeEach(() => forgetGoogleToken())

  /** Google, in memory: the token endpoint and the model behind one fake, each at its own address. */
  function googleSetup() {
    const model = new FakeModel('unused')
    model.serviceAccount = account
    const logged: string[] = []
    const calls: { url: string; init: RequestInit | undefined }[] = []
    let now = NOW
    const both = fetchBy({ 'https://oauth2.googleapis.com': model.fetch, 'https://aiplatform.eu.rep.googleapis.com': model.fetch })
    const deps = { fetch: async (input: string, init?: RequestInit) => (calls.push({ url: input, init }), both(input, init)), log: (line: string) => void logged.push(line), now: () => now }
    return { model, logged, calls, deps, later: (seconds: number) => void (now = new Date(now.getTime() + seconds * 1000)) }
  }

  it('gets a token first, then asks the model with it: the same request, and nothing only OpenRouter knows', async () => {
    const { model, deps, calls, logged } = googleSetup()
    model.answer = () => ({ results: [{ id: 1 }] })
    expect(await askModel(deps, google, req)).toEqual({ ok: true, value: { results: [{ id: 1 }] } })
    expect(calls.map((c) => c.url)).toEqual(['https://oauth2.googleapis.com/token', `${VERTEX}/chat/completions`])
    expect(model.tokenRequests).toHaveLength(1)
    expect(model.tokenRequests[0]!.signed).toBe(true)
    expect(model.tokenRequests[0]!.claims).toMatchObject({ iss: account.email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token' })
    const sent = model.requests[0]!
    expect(sent.headers).toEqual({ authorization: 'Bearer ya29.fake-1', 'content-type': 'application/json' })
    expect(sent.body).toEqual({
      model: 'google/test-model',
      messages: [
        { role: 'system', content: 'Describe each message.' },
        { role: 'user', content: JSON.stringify(req.input) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'feedback_messages', strict: true, schema: req.schema } },
    })
    expect('provider' in sent.body).toBe(false)
    // The key file itself goes nowhere: not to the model, and not to the token endpoint but as a signature.
    expect(JSON.stringify([model.requests, model.tokenRequests.map((r) => r.form)])).not.toContain('PRIVATE KEY')
    expect(calls[1]!.init?.redirect).toBe('manual')
    expect(logged).toEqual([])
  })

  it('asks for a token once: the next call uses the one kept, and a new one is made when its hour is nearly over', async () => {
    const { model, deps, calls, later } = googleSetup()
    await askModel(deps, google, req)
    later(600)
    expect((await askModel(deps, google, req)).ok).toBe(true)
    expect(model.tokenRequests).toHaveLength(1)
    expect(calls).toHaveLength(3)
    expect(model.requests.map((r) => r.headers['authorization'])).toEqual(['Bearer ya29.fake-1', 'Bearer ya29.fake-1'])
    later(3600 - 600 - TOKEN_MARGIN_S)
    expect((await askModel(deps, google, req)).ok).toBe(true)
    expect(model.tokenRequests).toHaveLength(2)
    expect(model.requests[2]!.headers['authorization']).toBe('Bearer ya29.fake-2')
  })

  it('gives the token and the model twenty seconds together, not each', async () => {
    const { model, deps, calls, logged } = googleSetup()
    await askModel(deps, google, req)
    forgetGoogleToken()
    await askModel(deps, google, req)
    // One clock for both requests of a call.
    expect(calls[2]!.init?.signal).toBeInstanceOf(AbortSignal)
    expect(calls[2]!.init?.signal).toBe(calls[3]!.init?.signal)
    expect(calls[0]!.init?.signal).not.toBe(calls[2]!.init?.signal)
    // A token endpoint that never answers: the call is given up when its time is over, and the model is not asked.
    forgetGoogleToken()
    const never = (_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason as Error)))
    const started = Date.now()
    expect(await askModel({ ...deps, fetch: never }, google, req, 40)).toEqual({ ok: false, why: 'late' })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(logged).toEqual(['feedback AI: late (token: TimeoutError)'])
    // A token that came late in the time leaves the model only what is left of it.
    const slow = async (input: string, init?: RequestInit) => {
      if (input.endsWith('/token')) {
        await new Promise((resolve) => setTimeout(resolve, 60))
        return model.fetch(input, init)
      }
      return never(input, init)
    }
    const again = Date.now()
    expect(await askModel({ ...deps, fetch: slow }, google, req, 120)).toEqual({ ok: false, why: 'late' })
    expect(Date.now() - again).toBeLessThan(175)
    expect(logged.at(-1)).toBe('feedback AI: late (model: TimeoutError)')
  })

  it('fails as the model does when the key file cannot be used, and asks nobody', async () => {
    const { model, deps, calls, logged } = googleSetup()
    for (const [key, detail] of [['{"client_email":', 'key file: not JSON'], [JSON.stringify({ client_email: account.email }), 'key file: no private_key'], [JSON.stringify({ client_email: account.email, private_key: 'x' }), 'key file: private_key'], [account.keyFile.replace('https://oauth2.googleapis.com/token', 'https://example.com/token'), 'key file: token_uri']] as const) {
      expect(await askModel(deps, { ...google, key }, req)).toEqual({ ok: false, why: 'refused' })
      expect(logged.at(-1)).toBe(`feedback AI: refused (${detail})`)
    }
    expect(calls).toEqual([])
    expect(model.requests).toEqual([])
  })

  it('fails as the model does when the token is refused or not reached, says it was the token and with which status, and does not ask the model', async () => {
    const { model, deps, logged } = googleSetup()
    for (const [status, why] of [[400, 'refused'], [401, 'refused'], [403, 'refused'], [429, 'unreachable'], [500, 'unreachable']] as const) {
      model.tokenFailure = { status }
      expect(await askModel(deps, google, req)).toEqual({ ok: false, why })
      expect(logged.at(-1)).toBe(`feedback AI: ${why} (token: ${status})`)
    }
    model.tokenFailure = { status: 200, body: '{}' }
    expect(await askModel(deps, google, req)).toEqual({ ok: false, why: 'unfit' })
    expect(logged.at(-1)).toBe('feedback AI: unfit (token: no access_token)')
    expect(model.tokenRequests).toHaveLength(6)
    expect(model.requests).toEqual([])
  })

  it('says it was the model when the model refuses, and keeps the token unless it was the token that was refused', async () => {
    const { model, deps, logged } = googleSetup()
    model.failure = { status: 403 }
    expect(await askModel(deps, google, req)).toEqual({ ok: false, why: 'refused' })
    expect(logged.at(-1)).toBe('feedback AI: refused (model: 403)')
    model.failure = { status: 500 }
    expect(await askModel(deps, google, req)).toEqual({ ok: false, why: 'unreachable' })
    expect(logged.at(-1)).toBe('feedback AI: unreachable (model: 500)')
    expect(model.tokenRequests).toHaveLength(1)
    // 401: the token is no longer taken. There is no second try; the next call makes a new one.
    model.failure = { status: 401 }
    expect(await askModel(deps, google, req)).toEqual({ ok: false, why: 'refused' })
    expect(logged.at(-1)).toBe('feedback AI: refused (model: 401)')
    expect(model.requests).toHaveLength(3)
    model.failure = null
    expect((await askModel(deps, google, req)).ok).toBe(true)
    expect(model.tokenRequests).toHaveLength(2)
    expect(model.requests[3]!.headers['authorization']).toBe('Bearer ya29.fake-2')
  })

  it('logs nothing of the key file, the JWT, the token or the messages, whatever went wrong', async () => {
    const { model, deps, logged } = googleSetup()
    // Both services echo what they were sent, as an error body may.
    model.tokenFailure = { status: 400 }
    await askModel(deps, google, req)
    model.tokenFailure = { status: 200, body: `not json ${account.privateKeyPem}` }
    await askModel(deps, google, req)
    const named = new Error(account.privateKeyPem)
    named.name = `${account.email} ${SECRET_TEXT}`
    model.tokenFailure = named
    await askModel(deps, google, req)
    model.tokenFailure = null
    model.failure = { status: 400 }
    await askModel(deps, google, req)
    model.failure = { status: 200, body: `not json: ${SECRET_TEXT} ya29.fake-1` }
    await askModel(deps, google, req)
    await askModel(deps, { ...google, key: account.keyFile.slice(0, -1) }, req)
    expect(logged).toEqual(['feedback AI: refused (token: 400)', 'feedback AI: unfit (token: not JSON)', 'feedback AI: unreachable (token: error)', 'feedback AI: refused (model: 400)', 'feedback AI: unfit (model: not JSON)', 'feedback AI: refused (key file: not JSON)'])
    const jwt = model.tokenRequests[0]!.form['assertion']!
    const all = logged.join('\n')
    for (const secret of [account.email, 'PRIVATE KEY', jwt, jwt.split('.')[1]!, jwt.split('.')[2]!, 'ya29', 'Ton', 'Describe', 'a-key-id']) expect(all).not.toContain(secret)
  })

  it('makes no token when the sign-in is a key', async () => {
    const { model, deps, calls } = googleSetup()
    model.serviceAccount = null
    expect(await askModel(deps, { ...google, auth: 'key', key: 'unused' }, req)).toMatchObject({ ok: true })
    expect(calls.map((c) => c.url)).toEqual([`${VERTEX}/chat/completions`])
    expect(model.requests[0]!.headers['authorization']).toBe('Bearer unused')
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
