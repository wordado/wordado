import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiReviewConfig } from '../config'
import type { QueueItem } from '../queues'
import { aiGate } from './gate'
import { AiReviewStore, rowContent } from './store'

const cfg: AiReviewConfig = { queues: ['level'], reviewers: { flash: { provider: 'openrouter', model: 'f' } }, default: 'flash', flag_when: 1 }
const item = (key: string, proposed: string, reopened = ''): QueueItem => ({ key, proposed, context: { reopened } })

describe('aiGate', () => {
  it('says nothing without an ai_review block', () => {
    expect(aiGate(undefined, new Map([['level', [item('a-1', 'A1')]]]), AiReviewStore.read(mkdtempSync(join(tmpdir(), 'g-'))))).toEqual([])
  })
  it('lists unreviewed and flagged rows, and passes reviewed ok rows', () => {
    const store = AiReviewStore.read(mkdtempSync(join(tmpdir(), 'g-')))
    const v = (key: string, proposed: string, verdict: 'ok' | 'major') => ({ key, reviewer: 'flash', model: 'f', prompt_version: 1, content: rowContent('level', proposed, ''), verdict, objections: [], at: 'n' })
    store.append('level', [v('a-1', 'A1', 'ok'), v('b-1', 'A2', 'major'), v('c-1', 'B1', 'ok')])
    const pending = new Map([['level', [item('a-1', 'A1'), item('b-1', 'A2'), item('c-1', 'B2'), item('d-1', 'A1')]], ['english', [item('e-1', 'x')]]])
    expect(aiGate(cfg, pending, store)).toEqual([
      'b-1: flagged by AI review, awaiting a decision (level)',
      'c-1: not yet AI-reviewed (level)',
      'd-1: not yet AI-reviewed (level)',
    ])
  })
  it('treats a new learner report as a change that needs review again', () => {
    const store = AiReviewStore.read(mkdtempSync(join(tmpdir(), 'g-')))
    store.append('level', [{ key: 'a-1', reviewer: 'flash', model: 'f', prompt_version: 1, content: rowContent('level', 'A1', ''), verdict: 'ok', objections: [], at: 'n' }])
    expect(aiGate(cfg, new Map([['level', [item('a-1', 'A1', '1 report: too easy')]]]), store)).toEqual(['a-1: not yet AI-reviewed (level)'])
  })
})
