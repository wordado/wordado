import { describe, expect, it } from 'vitest'
import { headwordForm } from './headwordForm'

describe('headwordForm', () => {
  it('gives a German noun its article and plural', () => {
    expect(headwordForm('de', { headword: 'Haus', pos: 'noun', grammar: { gender: 'n', plural: 'Häuser' } })).toEqual({ lead: 'das Haus', after: 'die Häuser' })
    expect(headwordForm('de', { headword: 'Frau', pos: 'noun', grammar: { gender: 'f', plural: 'Frauen' } })).toEqual({ lead: 'die Frau', after: 'die Frauen' })
    expect(headwordForm('de', { headword: 'Tisch', pos: 'noun', grammar: { gender: 'm', plural: 'Tische' } })).toEqual({ lead: 'der Tisch', after: 'die Tische' })
  })
  it('shows the article only for a noun with no plural (Review Focus 5)', () => {
    expect(headwordForm('de', { headword: 'Milch', pos: 'noun', grammar: { gender: 'f', plural: '' } })).toEqual({ lead: 'die Milch', after: '' })
  })
  it('marks a verb that takes sein, and nothing for haben', () => {
    expect(headwordForm('de', { headword: 'gehen', pos: 'verb', grammar: { separable: false, irregular: true, auxiliary: 'sein' } })).toEqual({ lead: 'gehen', after: '(+ sein)' })
    expect(headwordForm('de', { headword: 'kaufen', pos: 'verb', grammar: { separable: false, irregular: false, auxiliary: 'haben' } })).toEqual({ lead: 'kaufen', after: '' })
  })
  it('leaves English, an adjective and an unknown field alone', () => {
    expect(headwordForm('en', { headword: 'apple', pos: 'noun', grammar: null })).toEqual({ lead: 'apple', after: '' })
    expect(headwordForm('de', { headword: 'groß', pos: 'adj', grammar: null })).toEqual({ lead: 'groß', after: '' })
    expect(headwordForm('de', { headword: 'Haus', pos: 'noun', grammar: { gender: 'n', plural: 'Häuser', case: 'x' } })).toEqual({ lead: 'das Haus', after: 'die Häuser' })
  })
  it('reads no article from an inherited property: a gender of "constructor" or "toString" shows none', () => {
    expect(headwordForm('de', { headword: 'Ding', pos: 'noun', grammar: { gender: 'constructor', plural: '' } })).toEqual({ lead: 'Ding', after: '' })
    expect(headwordForm('de', { headword: 'Ding', pos: 'noun', grammar: { gender: 'toString', plural: '' } })).toEqual({ lead: 'Ding', after: '' })
  })
})
