import { describe, expect, it } from 'vitest'
import type { Env } from './bindings'
import { aiConfig, aiLimits, aiSetup, DEFAULT_AI_MODEL, DEFAULT_AI_URL, DEFAULT_DAILY_CALLS, isOpenRouter } from './feedbackAiConfig'

const env = (over: Partial<Env> = {}): Env => ({ APP_ORIGIN: 'https://review.test', ...over }) as Env

describe('the AI help’s settings', () => {
  it('has none while there is no key', () => {
    expect(aiConfig(env())).toBeNull()
    expect(aiConfig(env({ FEEDBACK_AI_KEY: '' }))).toBeNull()
    expect(aiConfig(env({ FEEDBACK_AI_KEY: '  ' }))).toBeNull()
  })

  it('falls back to the defaults', () => {
    expect(DEFAULT_AI_MODEL).toBe('google/gemini-3.8-flash')
    expect(DEFAULT_DAILY_CALLS).toBe(200)
    expect(aiConfig(env({ FEEDBACK_AI_KEY: ' k-1 ' }))).toEqual({ auth: 'key', key: 'k-1', model: 'google/gemini-3.8-flash', url: 'https://openrouter.ai/api/v1', standIn: false, dailyCalls: 200, reads: ['en', 'bg'] })
    expect(DEFAULT_AI_URL).toBe('https://openrouter.ai/api/v1')
    expect(aiConfig(env({ FEEDBACK_AI_KEY: 'k-1', FEEDBACK_AI_URL: '  ' }))?.url).toBe(DEFAULT_AI_URL)
    expect(aiLimits(env({ FEEDBACK_AI_MODEL: ' ', FEEDBACK_AI_DAILY_CALLS: '', FEEDBACK_READS: ' , ' }))).toEqual({ model: 'google/gemini-3.8-flash', dailyCalls: 200, reads: ['en', 'bg'] })
  })

  it('takes the model, the limit and the languages that need no translation', () => {
    const set = env({ FEEDBACK_AI_KEY: 'k-1', FEEDBACK_AI_MODEL: ' test/model ', FEEDBACK_AI_DAILY_CALLS: '0', FEEDBACK_READS: ' EN, bg ,De,' })
    expect(aiConfig(set)).toMatchObject({ model: 'test/model', dailyCalls: 0, reads: ['en', 'bg', 'de'] })
    expect(aiLimits(set)).toEqual({ model: 'test/model', dailyCalls: 0, reads: ['en', 'bg', 'de'] })
    expect(aiLimits(env({ FEEDBACK_READS: 'en,en,english,d3,es' })).reads).toEqual(['en', 'es'])
  })

  it('takes the default for a limit that is not a whole number from 0 up', () => {
    for (const bad of ['-1', '1.5', 'many', '1e3', ' 12 x']) expect(aiLimits(env({ FEEDBACK_AI_DAILY_CALLS: bad })).dailyCalls).toBe(200)
    expect(aiLimits(env({ FEEDBACK_AI_DAILY_CALLS: ' 12 ' })).dailyCalls).toBe(12)
  })

  it('takes the address of another service that speaks the same way, without a slash at its end', () => {
    const prod = { FEEDBACK_AI_KEY: 'k-1', APP_ORIGIN: 'https://review.wordado.com' }
    expect(aiConfig(env({ ...prod, FEEDBACK_AI_URL: ' https://ai.example.com/v1/ ' }))?.url).toBe('https://ai.example.com/v1')
    expect(aiConfig(env({ ...prod, FEEDBACK_AI_URL: 'https://ai.example.com' }))?.url).toBe('https://ai.example.com')
  })

  it('is not set up with an address that is not https: the key and the messages go nowhere, and to no other service instead', () => {
    const prod = { FEEDBACK_AI_KEY: 'k-1', APP_ORIGIN: 'https://review.wordado.com' }
    for (const bad of ['http://ai.example.com/v1', 'http://127.0.0.1:4184', 'ai.example.com/v1', 'ftp://ai.example.com', 'https://', 'https://user:pass@ai.example.com/v1', 'https://ai.example.com/v1?key=1', 'https://ai.example.com/v1#x']) {
      expect(aiConfig(env({ ...prod, FEEDBACK_AI_URL: bad }))).toBeNull()
    }
  })

  it('takes a stand-in model’s plain http address where a developer or a test runs the Worker, and nowhere else', () => {
    const standIn = { FEEDBACK_AI_KEY: 'k-1', FEEDBACK_AI_URL: 'http://127.0.0.1:4184' }
    expect(aiConfig(env({ ...standIn, APP_ORIGIN: 'http://127.0.0.1:4181' }))?.url).toBe('http://127.0.0.1:4184')
    expect(aiConfig(env(standIn))?.url).toBe('http://127.0.0.1:4184')
    expect(aiConfig(env(standIn))?.standIn).toBe(true)
    expect(aiConfig(env({ ...standIn, FEEDBACK_AI_URL: 'https://ai.example.com/v1', APP_ORIGIN: 'https://review.wordado.com' }))?.standIn).toBe(false)
    expect(aiConfig(env({ ...standIn, FEEDBACK_AI_URL: 'http://ai.example.com' }))).toBeNull()
  })

  it('knows OpenRouter’s address from any other', () => {
    for (const url of ['https://openrouter.ai/api/v1', 'https://openrouter.ai']) expect(isOpenRouter(url)).toBe(true)
    for (const url of ['https://ai.example.com/v1', 'https://openrouter.ai.example.com/api/v1', 'https://example.com/openrouter.ai', 'http://127.0.0.1:4184', 'not an address']) expect(isOpenRouter(url)).toBe(false)
  })

  it('names the setting that is missing or wrong, the first of them', () => {
    expect(aiSetup(env())).toEqual({ config: null, needs: 'FEEDBACK_AI_KEY' })
    expect(aiSetup(env({ FEEDBACK_AI_KEY: 'k-1', FEEDBACK_AI_URL: 'http://ai.example.com/v1' }))).toEqual({ config: null, needs: 'FEEDBACK_AI_URL' })
    expect(aiSetup(env({ FEEDBACK_AI_URL: 'http://ai.example.com/v1' }))).toEqual({ config: null, needs: 'FEEDBACK_AI_KEY' })
    expect(aiSetup(env({ FEEDBACK_AI_KEY: 'k-1', FEEDBACK_AI_URL: 'https://ai.example.com/v1', FEEDBACK_AI_AUTH: 'google' }))).toEqual({ config: null, needs: 'FEEDBACK_AI_AUTH' })
    expect(aiSetup(env({ FEEDBACK_AI_KEY: 'k-1' })).needs).toBeNull()
  })
})

describe('the AI help’s sign-in', () => {
  const VERTEX = 'https://aiplatform.eu.rep.googleapis.com/v1/projects/a-project/locations/eu/endpoints/openapi'
  const google = { FEEDBACK_AI_AUTH: 'google-service-account', FEEDBACK_AI_KEY: '{"client_email":"x"}', FEEDBACK_AI_URL: VERTEX, APP_ORIGIN: 'https://review.wordado.com' }

  it('is by key unless FEEDBACK_AI_AUTH says otherwise', () => {
    for (const auth of [undefined, '', '  ', 'key', ' key ']) expect(aiConfig(env({ FEEDBACK_AI_KEY: 'k-1', ...(auth === undefined ? {} : { FEEDBACK_AI_AUTH: auth }) }))?.auth).toBe('key')
  })

  it('is not set up with a sign-in it does not know: the secret is never sent as a key instead', () => {
    for (const auth of ['google', 'service-account', 'KEY', 'Google-Service-Account', 'key,google-service-account']) {
      expect(aiSetup(env({ FEEDBACK_AI_KEY: 'k-1', FEEDBACK_AI_AUTH: auth }))).toEqual({ config: null, needs: 'FEEDBACK_AI_AUTH' })
    }
  })

  it('takes a Google service account: the key file as the secret, a Google address, the model', () => {
    expect(aiConfig(env({ ...google, FEEDBACK_AI_URL: ` ${VERTEX}/ ` }))).toEqual({ auth: 'google-service-account', key: '{"client_email":"x"}', model: 'google/gemini-3.8-flash', url: VERTEX, standIn: false, dailyCalls: 200, reads: ['en', 'bg'] })
    for (const good of ['https://europe-west1-aiplatform.googleapis.com/v1/projects/p/locations/europe-west1/endpoints/openapi', 'https://aiplatform.googleapis.com/v1/projects/p/locations/global/endpoints/openapi']) {
      expect(aiConfig(env({ ...google, FEEDBACK_AI_URL: good }))?.url).toBe(good)
    }
  })

  it('has no address of its own for a service account: none set is not set up, and so is one that is not Google’s', () => {
    const { FEEDBACK_AI_URL: _url, ...none } = google
    expect(aiSetup(env(none))).toEqual({ config: null, needs: 'FEEDBACK_AI_URL' })
    for (const bad of ['', 'https://openrouter.ai/api/v1', 'https://ai.example.com/v1', 'https://googleapis.com.example.com/v1', 'https://example.com/aiplatform.googleapis.com', 'https://notgoogleapis.com/v1', 'http://aiplatform.eu.rep.googleapis.com/v1', 'http://127.0.0.1:4184', `${VERTEX}?key=1`]) {
      expect(aiSetup(env({ ...google, FEEDBACK_AI_URL: bad }))).toEqual({ config: null, needs: 'FEEDBACK_AI_URL' })
    }
    expect(aiSetup(env({ ...google, FEEDBACK_AI_KEY: ' ' }))).toEqual({ config: null, needs: 'FEEDBACK_AI_KEY' })
  })

  it('takes {project} in the path of a service account’s address, to be filled from the key file, and nowhere else', () => {
    const open = 'https://aiplatform.eu.rep.googleapis.com/v1/projects/{project}/locations/eu/endpoints/openapi'
    expect(aiConfig(env({ ...google, FEEDBACK_AI_URL: open }))?.url).toBe(open)
    for (const bad of ['https://{project}.googleapis.com/v1', 'https://aiplatform.googleapis.com/v1/projects/{project_id}/x', 'https://aiplatform.googleapis.com/v1/projects/{project/x', 'https://aiplatform.googleapis.com/v1/projects/project}/x', 'https://aiplatform.googleapis.com/v1/{location}/{project}']) {
      expect(aiSetup(env({ ...google, FEEDBACK_AI_URL: bad }))).toEqual({ config: null, needs: 'FEEDBACK_AI_URL' })
    }
    // By key there is no key file to fill it from.
    expect(aiSetup(env({ FEEDBACK_AI_KEY: 'k-1', FEEDBACK_AI_URL: 'https://ai.example.com/v1/{project}', APP_ORIGIN: 'https://review.wordado.com' }))).toEqual({ config: null, needs: 'FEEDBACK_AI_URL' })
  })

  it('takes a stand-in on this machine for a service account too, where a developer or a test runs the Worker', () => {
    expect(aiConfig(env({ ...google, FEEDBACK_AI_URL: 'http://127.0.0.1:4184', APP_ORIGIN: 'http://127.0.0.1:4181' }))).toMatchObject({ auth: 'google-service-account', url: 'http://127.0.0.1:4184', standIn: true })
    expect(aiConfig(env({ ...google, FEEDBACK_AI_URL: 'https://model.test/v1', APP_ORIGIN: 'https://review.test' }))).toBeNull()
  })
})
