import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LicenceError, licenceProblems, readClearedSources, type SourceRecord } from './sources'

const cleared: SourceRecord = {
  id: 'invented',
  file: 'invented.tsv',
  title: 'Invented list',
  url: 'https://example.invalid',
  licence: 'CC0-1.0',
  commercial_use: true,
  share_alike: false,
  attribution: '',
  cleared_by: 'Legal review',
  cleared_on: '2026-10-01',
  notes: '',
}

function content(records: unknown[], files: Record<string, string> = { 'invented.tsv': 'water\t10\n' }): string {
  const dir = mkdtempSync(join(tmpdir(), 'sources-'))
  writeFileSync(join(dir, 'sources.json'), JSON.stringify(records))
  mkdirSync(join(dir, 'sources'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'sources', name), text)
  return dir
}

describe('licenceProblems (spec §5.4, §15)', () => {
  it('passes a cleared, commercial, non-share-alike source', () => {
    expect(licenceProblems(cleared)).toEqual([])
  })

  it('refuses share-alike, non-commercial and uncleared sources, each by name', () => {
    expect(licenceProblems({ ...cleared, share_alike: true, commercial_use: false, cleared_by: '', cleared_on: '' })).toEqual([
      'invented: does not permit commercial use',
      'invented: is share-alike, which would bind the corpus',
      'invented: not cleared by the legal review (cleared_by and cleared_on are empty)',
    ])
  })

  it('refuses a clearance date that is not a date', () => {
    expect(licenceProblems({ ...cleared, cleared_on: 'soon' })).toEqual(['invented: cleared_on must be YYYY-MM-DD'])
  })
})

describe('readClearedSources', () => {
  it('reads every source when all are cleared', () => {
    expect(readClearedSources(content([cleared])).map((s) => s.text)).toEqual(['water\t10\n'])
  })

  it('reads nothing when any one source is not cleared, and names it', () => {
    const dir = content([cleared, { ...cleared, id: 'other', file: 'other.tsv', cleared_by: '' }], {
      'invented.tsv': 'water\t10\n',
      'other.tsv': 'bread\t5\n',
    })
    expect(() => readClearedSources(dir)).toThrow(LicenceError)
    expect(() => readClearedSources(dir)).toThrow(/other: not cleared/)
  })

  it('refuses an empty register: there is nothing to build from', () => {
    expect(() => readClearedSources(content([]))).toThrow(/no sources/)
  })

  it('names a listed file that is missing, and a file path that leaves sources/', () => {
    const dir = content([{ ...cleared, file: 'gone.tsv' }, { ...cleared, id: 'escape', file: '../x.tsv' }])
    expect(() => readClearedSources(dir)).toThrow(/invented: sources\/gone\.tsv is missing[\s\S]*escape: file must be a name inside sources\//)
  })
})
