import { describe, expect, it } from 'vitest'
import type { Env } from './bindings'
import { aiConfig, aiLimits, DEFAULT_AI_MODEL, DEFAULT_DAILY_CALLS, MODEL_URL } from './feedbackAiConfig'

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
    expect(aiConfig(env({ FEEDBACK_AI_KEY: ' k-1 ' }))).toEqual({ key: 'k-1', model: 'google/gemini-3.8-flash', url: MODEL_URL, dailyCalls: 200, reads: ['en', 'bg'] })
    expect(MODEL_URL).toBe('https://openrouter.ai/api/v1/chat/completions')
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

  it('takes a stand-in model’s address on a local or test origin only', () => {
    const standIn = { FEEDBACK_AI_KEY: 'k-1', FEEDBACK_AI_URL: 'http://127.0.0.1:4184' }
    expect(aiConfig(env(standIn))?.url).toBe('http://127.0.0.1:4184')
    expect(aiConfig(env({ ...standIn, APP_ORIGIN: 'http://127.0.0.1:4181' }))?.url).toBe('http://127.0.0.1:4184')
    expect(aiConfig(env({ ...standIn, APP_ORIGIN: 'https://review.wordado.com' }))?.url).toBe(MODEL_URL)
  })
})
