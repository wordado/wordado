import { describe, expect, it } from 'vitest'
import { corpusWordId, isWordId, parseWordId, toWordId, userWordId } from './wordId'

describe('wordId', () => {
  it('namespaces corpus entries and user words', () => {
    expect(corpusWordId('en-000123')).toBe('c:en-000123')
    expect(userWordId('0b9c2f4e-1111-4222-8333-444455556666')).toBe(
      'u:0b9c2f4e-1111-4222-8333-444455556666',
    )
  })

  it('round-trips through parse', () => {
    expect(parseWordId(corpusWordId('en-000123'))).toEqual({ kind: 'corpus', key: 'en-000123' })
    expect(parseWordId(userWordId('abc'))).toEqual({ kind: 'user', key: 'abc' })
  })

  it('rejects anything outside the two namespaces', () => {
    for (const bad of ['', 'c:', 'u:', 'x:1', 'c:has space', 'en-000123', 'c::1']) {
      expect(isWordId(bad)).toBe(false)
      expect(() => toWordId(bad)).toThrow(/Invalid word_id/)
    }
  })
})
