import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiReviewConfig } from '../config'
import { AiReviewStore, type AiVerdict } from './store'
import { aiState, allVerdicts } from './vote'

const cfg = (over: Partial<AiReviewConfig> = {}): AiReviewConfig => ({
  queues: ['level'],
  reviewers: { flash: { provider: 'openrouter', model: 'f' }, pro: { provider: 'openrouter', model: 'p' }, gpt: { provider: 'openrouter', model: 'g' }, bggpt: { provider: 'local', model: 'b', url: 'http://x' } },
  default: 'flash',
  flag_when: 1,
  ...over,
})
const verdict = (reviewer: string, kind: 'ok' | 'minor' | 'major'): AiVerdict => ({ key: 'a-1', reviewer, model: reviewer, prompt_version: 1, content: 'C', verdict: kind, objections: [], at: '2026-10-05T00:00:00Z' })
function store(...vs: AiVerdict[]) {
  const s = AiReviewStore.read(mkdtempSync(join(tmpdir(), 'vote-')))
  s.append('level', vs)
  return s
}

describe('aiState', () => {
  it('is unreviewed until every required reviewer has a current verdict', () => {
    expect(aiState(store(), cfg(), 'level', 'a-1', 'C')).toEqual({ status: 'unreviewed', missing: ['flash'] })
    expect(aiState(store(verdict('flash', 'ok')), cfg({ required: ['flash', 'pro'], flag_when: 1 }), 'level', 'a-1', 'C')).toEqual({ status: 'unreviewed', missing: ['pro'] })
    expect(aiState(store(verdict('flash', 'ok')), cfg(), 'level', 'a-1', 'OTHER').status).toBe('unreviewed')
  })
  it('flags when at least flag_when required reviewers object', () => {
    expect(aiState(store(verdict('flash', 'minor')), cfg(), 'level', 'a-1', 'C').status).toBe('flagged')
    expect(aiState(store(verdict('flash', 'ok')), cfg(), 'level', 'a-1', 'C').status).toBe('passed')
    const three = cfg({ required: ['flash', 'pro', 'gpt'], flag_when: 2 })
    expect(aiState(store(verdict('flash', 'major'), verdict('pro', 'ok'), verdict('gpt', 'ok')), three, 'level', 'a-1', 'C').status).toBe('passed')
    expect(aiState(store(verdict('flash', 'major'), verdict('pro', 'minor'), verdict('gpt', 'ok')), three, 'level', 'a-1', 'C').status).toBe('flagged')
  })
  it('ignores a reviewer that is not required, but shows it', () => {
    const s = store(verdict('flash', 'ok'), verdict('bggpt', 'major'))
    expect(aiState(s, cfg(), 'level', 'a-1', 'C').status).toBe('passed')
    expect(allVerdicts(s, cfg(), 'level', 'a-1', 'C').map((x) => x.reviewer)).toEqual(['flash', 'bggpt'])
  })
})
