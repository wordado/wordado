import { describe, expect, it } from 'vitest'
import { GRAMMAR_SCHEMAS, grammarProblems } from './grammar'

describe('grammarProblems', () => {
  it('accepts a German noun and a German verb', () => {
    expect(grammarProblems('de', 'noun', { gender: 'n', plural: 'Häuser' })).toEqual([])
    expect(grammarProblems('de', 'verb', { separable: true, irregular: false, auxiliary: 'sein' })).toEqual([])
  })
  it('refuses wrong values and fields of another part of speech', () => {
    expect(grammarProblems('de', 'noun', { gender: 'x', plural: 'Häuser' })).toEqual(['gender must be one of m, f, n'])
    expect(grammarProblems('de', 'verb', { gender: 'm' })).toEqual(['gender is not a field of a verb'])
    expect(grammarProblems('de', 'noun', { plural: 3 })).toEqual(['plural must be text'])
    expect(grammarProblems('de', 'verb', { separable: 'yes' })).toEqual(['separable must be true or false'])
  })
  it('ignores a field it does not know, as an older client must', () => {
    expect(grammarProblems('de', 'noun', { gender: 'f', plural: '', case: 'x' })).toEqual([])
  })
  it('ignores names inherited from Object, and a target named so', () => {
    expect(grammarProblems('de', 'noun', { gender: 'f', plural: '', constructor: 'x' })).toEqual([])
    expect(grammarProblems('toString', 'noun', {})).toEqual(['toString has no grammar block'])
  })
  it('refuses a grammar block on a target without a schema', () => {
    expect(GRAMMAR_SCHEMAS.en).toBeUndefined()
    expect(grammarProblems('en', 'noun', { gender: 'm' })).toEqual(['en has no grammar block'])
  })
  it('refuses a block that is not an object', () => {
    expect(grammarProblems('de', 'noun', 'm')).toEqual(['must be an object'])
  })
})
