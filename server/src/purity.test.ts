import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

describe('server/src', () => {
  it('uses no Node-only API: no node: imports, no require, no process (spec §4.4)', () => {
    const forbidden = /from\s+['"]node:|import\(\s*['"]node:|\brequire\(|\bprocess\./
    const offenders = sources(import.meta.dirname).filter((file) => forbidden.test(readFileSync(file, 'utf8')))
    expect(offenders.map((file) => relative(import.meta.dirname, file))).toEqual([])
  })
})
