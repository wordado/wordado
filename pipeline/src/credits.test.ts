import { describe, expect, it } from 'vitest'
import { checkedCredits, creditsFile } from './credits'
import type { SourceRecord } from './sources'

const record = (title: string, attribution: string): { record: SourceRecord } => ({
  record: { id: title, file: `${title}.tsv`, title, url: '', licence: 'CC BY 3.0', commercial_use: true, share_alike: false, attribution, cleared_by: 'x', cleared_on: '2026-09-28', notes: '' },
})

describe('creditsFile', () => {
  it('lists every source that needs an attribution, in register order, at the given version', () => {
    expect(creditsFile([record('FineWeb', 'From FineWeb (ODC-By 1.0).'), record('Invented', ' '), record('Google Books', 'From Google Books (CC BY 3.0).')], 1)).toEqual({
      schema_version: 1,
      corpus_version: 1,
      sources: [
        { source: 'FineWeb', attribution: 'From FineWeb (ODC-By 1.0).' },
        { source: 'Google Books', attribution: 'From Google Books (CC BY 3.0).' },
      ],
    })
  })
})

describe('checkedCredits', () => {
  it('returns the built file when it is one the app will accept', () => {
    expect(checkedCredits([record('FineWeb', 'From FineWeb (ODC-By 1.0).')], 1)).toEqual({
      schema_version: 1,
      corpus_version: 1,
      sources: [{ source: 'FineWeb', attribution: 'From FineWeb (ODC-By 1.0).' }],
    })
  })

  it('throws, naming the source, when one needs an attribution but has a blank title', () => {
    const blankTitle: { record: SourceRecord } = { record: { ...record('x', 'Needs a title.').record, id: 'invented-2', title: '' } }
    expect(() => checkedCredits([blankTitle], 1)).toThrow(/invented-2/)
  })
})
