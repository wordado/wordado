import { describe, expect, it } from 'vitest'
import type { Env } from './bindings'
import { aiConfig, aiLimits, DEFAULT_AI_MODEL, DEFAULT_AI_URL, DEFAULT_DAILY_CALLS, isOpenRouter } from './feedbackAiConfig'

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
    expect(aiConfig(env({ FEEDBACK_AI_KEY: ' k-1 ' }))).toEqual({ key: 'k-1', model: 'google/gemini-3.8-flash', url: 'https://openrouter.ai/api/v1', dailyCalls: 200, reads: ['en', 'bg'] })
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
    expect(aiConfig(env({ ...standIn, FEEDBACK_AI_URL: 'http://ai.example.com' }))).toBeNull()
  })

  it('knows OpenRouter’s address from any other', () => {
    for (const url of ['https://openrouter.ai/api/v1', 'https://openrouter.ai']) expect(isOpenRouter(url)).toBe(true)
    for (const url of ['https://ai.example.com/v1', 'https://openrouter.ai.example.com/api/v1', 'https://example.com/openrouter.ai', 'http://127.0.0.1:4184', 'not an address']) expect(isOpenRouter(url)).toBe(false)
  })
})
