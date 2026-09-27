import { describe, expect, it } from 'vitest'
import { parseFrequencyList, rankForms } from './frequency'

describe('parseFrequencyList', () => {
  it('reads tab- or space-separated counts, skipping comments, blanks and a header', () => {
    const list = parseFrequencyList('# an invented list\nword\tcount\nthe\t100\n\nwater 40\n', 'x')
    expect([...list]).toEqual([['the', 100], ['water', 40]])
  })

  it('lowercases, merges forms that meet after normalising, and keeps apostrophes and hyphens', () => {
    const list = parseFrequencyList("The\t5\nthe\t3\ndon't\t2\nwell-known\t1\n", 'x')
    expect([...list]).toEqual([['the', 8], ["don't", 2], ['well-known', 1]])
  })

  it('drops tokens that are not words: numbers, punctuation, stray symbols', () => {
    expect([...parseFrequencyList('42\t9\n...\t9\n@home\t9\ncafé\t2\n', 'x')]).toEqual([['café', 2]])
  })

  it('names the source and line of a bad count', () => {
    expect(() => parseFrequencyList('form\tcount\nthe\t5\nwater\tmany\n', 'subs')).toThrow('subs:3: count must be a positive integer')
  })
})

describe('rankForms', () => {
  it('ranks by the mean per-million rate across lists, a missing form counting zero', () => {
    const a = new Map([['the', 900], ['water', 100]])
    const b = new Map([['the', 50], ['bread', 50]])
    expect(rankForms([a, b], 10)).toEqual([
      { form: 'the', perMillion: 700000, rank: 1 },
      { form: 'bread', perMillion: 250000, rank: 2 },
      { form: 'water', perMillion: 50000, rank: 3 },
    ])
  })

  it('breaks ties by form, so the ranking is the same on every machine', () => {
    expect(rankForms([new Map([['b', 1], ['a', 1]])], 10).map((f) => f.form)).toEqual(['a', 'b'])
  })

  it('keeps only the top max forms', () => {
    expect(rankForms([new Map([['a', 3], ['b', 2], ['c', 1]])], 2).map((f) => f.form)).toEqual(['a', 'b'])
  })
})
