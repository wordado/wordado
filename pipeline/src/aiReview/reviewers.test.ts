import { describe, expect, it } from 'vitest'
import { reviewerLlm } from './reviewers'

describe('reviewerLlm', () => {
  it('makes an OpenRouter client for an openrouter reviewer and a local one for a local reviewer', () => {
    const key = () => 'k'
    expect(reviewerLlm({ provider: 'openrouter', model: 'google/gemini-3.8-flash' }, { maxUsd: 1, apiKey: key }).model).toBe('google/gemini-3.8-flash')
    expect(reviewerLlm({ provider: 'local', model: 'bggpt', url: 'http://127.0.0.1:8091' }, { maxUsd: 1, apiKey: key }).model).toBe('local:bggpt')
  })
  it('does not ask for the OpenRouter key for a local reviewer', () => {
    const key = () => {
      throw new Error('no key')
    }
    expect(() => reviewerLlm({ provider: 'local', model: 'm', url: 'http://x' }, { maxUsd: 1, apiKey: key })).not.toThrow()
  })
})
