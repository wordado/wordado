import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendJsonl, readJsonl, readJsonOr, writeJson } from './files'

const dir = () => mkdtempSync(join(tmpdir(), 'files-'))

describe('files', () => {
  it('writes JSON with a trailing newline, creating directories', () => {
    const file = join(dir(), 'a', 'b.json')
    writeJson(file, { x: 1 })
    expect(readFileSync(file, 'utf8')).toBe('{\n  "x": 1\n}\n')
  })

  it('reads a fallback for a missing JSON file', () => {
    expect(readJsonOr(join(dir(), 'none.json'), [])).toEqual([])
  })

  it('appends JSONL lines and reads them back; a missing file is empty', () => {
    const file = join(dir(), 'c', 'd.jsonl')
    expect(readJsonl(file)).toEqual([])
    appendJsonl(file, [{ a: 1 }])
    appendJsonl(file, [{ a: 2 }, { a: 'з' }])
    expect(readJsonl(file)).toEqual([{ a: 1 }, { a: 2 }, { a: 'з' }])
  })

  it('names the file and line of a broken JSONL line', () => {
    const file = join(dir(), 'e.jsonl')
    appendJsonl(file, [{ a: 1 }])
    appendFileSync(file, '{broken\n')
    expect(() => readJsonl(file)).toThrow(/e\.jsonl:2/)
  })
})
