import { describe, expect, it } from 'vitest'
import { ParseError } from '../llm'
import { AI_REVIEW_VERSION, queueKind, reviewRequest, type ReviewRow } from './prompts'

const row = (key: string, cells: Record<string, string>, context: Record<string, unknown> = {}): ReviewRow => ({ key, cells, context })
const answer = (items: unknown[]) => ({ items })
const err = (field: string, category: string, severity: string, fix: string) => ({ field, category, severity, reason: 'because', fix })

describe('queueKind', () => {
  it('knows the three kinds AI review covers', () => {
    expect([queueKind('translation-bg'), queueKind('title-de'), queueKind('level'), queueKind('english'), queueKind('audio')]).toEqual(['translation', 'title', 'level', null, null])
    expect(AI_REVIEW_VERSION).toEqual({ translation: 1, title: 1, level: 1 })
  })
})

describe('reviewRequest', () => {
  it('gives the translation reviewer the L1 guide and the rows with their context', () => {
    const req = reviewRequest('translation-bg', [row('bank-1', { translation: 'банка', alternates: '', sense: '' }, { headword: 'bank', other_live_senses: [] })])
    expect(req.system).toContain('Translate into Bulgarian')
    expect(req.system).toContain('alternate')
    expect(req.input).toEqual({ rows: [{ key: 'bank-1', translation: 'банка', alternates: '', sense: '', headword: 'bank', other_live_senses: [] }] })
  })

  it('gives the level reviewer the CEFR descriptors', () => {
    expect(reviewRequest('level', [row('x-1', { level: 'B1' })]).system).toContain('handles abstract and technical topics')
  })

  it('refuses an answer about other rows than it asked', () => {
    const req = reviewRequest('level', [row('a-1', { level: 'A1' }), row('b-1', { level: 'A2' })])
    expect(() => req.parse(answer([{ key: 'b-1', errors: [], verdict: 'ok', confidence: 1 }, { key: 'a-1', errors: [], verdict: 'ok', confidence: 1 }]))).toThrow(ParseError)
    expect(() => req.parse(answer([{ key: 'a-1', errors: [], verdict: 'ok', confidence: 1 }]))).toThrow(ParseError)
  })

  it('drops objections that change nothing or are not valid, and sets the verdict from what is left', () => {
    const req = reviewRequest('translation-bg', [
      row('a-1', { translation: 'около', alternates: 'наоколо', sense: '' }),
      row('b-1', { translation: 'час', alternates: '', sense: '' }),
    ])
    const out = req.parse(
      answer([
        { key: 'a-1', errors: [err('alternates', 'alternate-wrong', 'major', ''), err('sense', 'sense', 'minor', '')], verdict: 'minor', confidence: 0.9 },
        { key: 'b-1', errors: [err('translation', 'wrong-sense', 'major', 'час'), err('nonsense', 'other', 'minor', 'x')], verdict: 'major', confidence: 0.4 },
      ]),
    )
    expect(out).toEqual([
      { key: 'a-1', verdict: 'major', objections: [{ field: 'alternates', category: 'alternate-wrong', severity: 'major', reason: 'because', fix: '' }] },
      { key: 'b-1', verdict: 'ok', objections: [] },
    ])
  })

  it('takes a level fix only when it is a CEFR level, in capitals', () => {
    const req = reviewRequest('level', [row('a-1', { level: 'A1' }), row('b-1', { level: 'B1' })])
    const out = req.parse(
      answer([
        { key: 'a-1', errors: [err('level', 'too-low', 'major', 'b2')], verdict: 'major', confidence: 1 },
        { key: 'b-1', errors: [err('level', 'too-high', 'major', 'B3')], verdict: 'major', confidence: 1 },
      ]),
    )
    expect(out).toEqual([
      { key: 'a-1', verdict: 'major', objections: [{ field: 'level', category: 'too-low', severity: 'major', reason: 'because', fix: 'B2' }] },
      { key: 'b-1', verdict: 'ok', objections: [] },
    ])
  })
})
