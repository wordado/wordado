import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { publishProblems } from './publishable'

const DIR = fileURLToPath(new URL('../samples/a1-bg/', import.meta.url))

/** Reads the sample, with some files replaced (bytes) or removed (null). */
function sample(over: Record<string, Uint8Array | null> = {}) {
  return (path: string): Uint8Array | null => {
    if (path in over) return over[path]!
    const full = join(DIR, path)
    return existsSync(full) ? new Uint8Array(readFileSync(full)) : null
  }
}

const manifest = () => JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'))
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

describe('publishProblems (spec §4.4: never a manifest whose files are not all in place)', () => {
  it('finds nothing wrong with the sample', () => {
    expect(publishProblems(sample())).toEqual([])
  })

  it('names a missing manifest', () => {
    expect(publishProblems(sample({ 'manifest.json': null }))).toEqual(['manifest.json: missing'])
  })

  it("names a pack whose bytes differ from the manifest's checksum", () => {
    const pack = readFileSync(join(DIR, 'corpus-v0-bg.pack'))
    const tampered = new Uint8Array(pack)
    tampered[10] = tampered[10]! ^ 1
    expect(publishProblems(sample({ 'corpus-v0-bg.pack': tampered }))).toEqual(['corpus-v0-bg.pack: sha256 does not match the manifest'])
  })

  it('names a missing or truncated clip', () => {
    const clip = new Uint8Array(readFileSync(join(DIR, 'audio/hello-1-uk.m4a')))
    expect(publishProblems(sample({ 'audio/hello-1-uk.m4a': null }))).toEqual(['audio/hello-1-uk.m4a: missing'])
    expect(publishProblems(sample({ 'audio/hello-1-uk.m4a': clip.slice(0, 100) }))).toEqual([
      `audio/hello-1-uk.m4a: ${100} bytes, the pack says ${clip.length}`,
    ])
  })

  it('refuses a URL that is not relative to the manifest', () => {
    const m = manifest()
    m.packs[0].url = 'https://elsewhere.example/corpus-v0-bg.pack'
    expect(publishProblems(sample({ 'manifest.json': bytes(m) }))).toEqual([
      'manifest.json packs[0].url: must be a relative path without ".."',
    ])
    m.packs[0].url = '../corpus-v0-bg.pack'
    expect(publishProblems(sample({ 'manifest.json': bytes(m) }))).toEqual([
      'manifest.json packs[0].url: must be a relative path without ".."',
    ])
  })

  it("names an invalid manifest by its validator's errors", () => {
    expect(publishProblems(sample({ 'manifest.json': bytes({ schema_version: 1 }) })).length).toBeGreaterThan(0)
  })
})
