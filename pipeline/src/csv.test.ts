import { describe, expect, it } from 'vitest'
import { csvRecords, formatCsv, parseCsv } from './csv'

describe('parseCsv', () => {
  it('reads quoted cells holding commas, quotes and line breaks', () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\n')).toEqual([['a', 'b, c', 'say "hi"', 'two\nlines']])
  })

  it('reads what a spreadsheet writes back: a BOM, CRLF, and no final newline', () => {
    expect(parseCsv('﻿key,verdict\r\nhello-1,OK\r\nwater-1,')).toEqual([
      ['key', 'verdict'],
      ['hello-1', 'OK'],
      ['water-1', ''],
    ])
  })

  it('keeps empty cells and drops blank lines', () => {
    expect(parseCsv('a,,c\n\n,b,\n')).toEqual([['a', '', 'c'], ['', 'b', '']])
  })

  it('refuses an unterminated quote rather than guessing', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/unterminated/)
  })
})

describe('formatCsv', () => {
  it('writes a BOM and CRLF, and quotes only the cells that need it', () => {
    expect(formatCsv([['key', 'note'], ['a', 'x, "y"']])).toBe('﻿key,note\r\na,"x, ""y"""\r\n')
  })

  it('round-trips through parseCsv', () => {
    const rows = [['к', 'здравей | здравейте'], ['line\nbreak', '"q"']]
    expect(parseCsv(formatCsv(rows))).toEqual(rows)
  })
})

describe('csvRecords', () => {
  it('keys each row by the header, trimming header names', () => {
    expect(csvRecords('key , verdict\nhello-1,ok\n')).toEqual({ header: ['key', 'verdict'], rows: [{ key: 'hello-1', verdict: 'ok' }] })
  })

  it('fills cells a spreadsheet dropped from the end of a row', () => {
    expect(csvRecords('key,verdict,note\nhello-1\n').rows).toEqual([{ key: 'hello-1', verdict: '', note: '' }])
  })
})
