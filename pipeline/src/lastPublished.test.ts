import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLastPublished } from './lastPublished'
import { makeContent } from './testing/fixture'

describe('readLastPublished', () => {
  it('reads the sample as version 0, every entry live and published', () => {
    const last = readLastPublished(makeContent())
    expect(last.manifest.corpus_version).toBe(0)
    expect([...last.packs.keys()]).toEqual(['bg'])
    expect(last.live.size).toBe(60)
    expect(last.published.has('hello-1')).toBe(true)
    expect(last.fixes).toEqual({ schema_version: 1, corpus_version: 0, fixes: [] })
  })

  it('refuses a pack whose bytes do not match the manifest', () => {
    const dir = makeContent()
    const file = join(dir, 'last-published', 'corpus-v0-bg.pack')
    writeFileSync(file, readFileSync(file, 'utf8').replace('здравей', 'здрасти'))
    expect(() => readLastPublished(dir)).toThrow(/corpus-v0-bg\.pack: sha256 does not match/)
  })
})
