import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AiReviewStore, rowContent, type AiVerdict } from './store'

const dir = () => mkdtempSync(join(tmpdir(), 'ai-store-'))
const v = (over: Partial<AiVerdict> = {}): AiVerdict => ({
  key: 'bank-1', reviewer: 'flash', model: 'google/gemini-3.8-flash', prompt_version: 1,
  content: rowContent('translation-bg', { translation: 'банка', alternates: [], sense: '' }, ''),
  verdict: 'ok', objections: [], at: '2026-10-05T08:00:00Z', ...over,
})

describe('rowContent', () => {
  it('changes when the proposal or the learner note changes, not with key order', () => {
    const a = rowContent('translation-bg', { translation: 'x', alternates: [], sense: '' }, '')
    expect(rowContent('translation-bg', { sense: '', alternates: [], translation: 'x' }, '')).toBe(a)
    expect(rowContent('translation-bg', { translation: 'y', alternates: [], sense: '' }, '')).not.toBe(a)
    expect(rowContent('translation-bg', { translation: 'x', alternates: [], sense: '' }, '1 report: odd')).not.toBe(a)
    expect(rowContent('translation-de', { translation: 'x', alternates: [], sense: '' }, '')).not.toBe(a)
  })
})

describe('AiReviewStore', () => {
  it('keeps verdicts across a reopen, and answers only for the same content, reviewer and prompt version', () => {
    const d = dir()
    AiReviewStore.read(d).append('translation-bg', [v(), v({ verdict: 'major', at: '2026-10-06T08:00:00Z' }), v({ reviewer: 'bggpt' }), v({ prompt_version: 0 })])
    const s = AiReviewStore.read(d)
    expect(s.current('translation-bg', 'bank-1', 'flash', v().content)?.verdict).toBe('major')
    expect(s.current('translation-bg', 'bank-1', 'flash', 'other')).toBeUndefined()
    expect(s.current('title-bg', 'bank-1', 'flash', v().content)).toBeUndefined()
  })
})
