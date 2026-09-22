import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildMatchingBoard,
  loadCorpus,
  offeredThemes,
  pickDistractors,
  seededRng,
  themeEntries,
  validatePack,
  type WordId,
} from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { buildPack } from './build'
import { readSourceDir } from './fs'

const DIR = fileURLToPath(new URL('../samples/a1-bg/', import.meta.url))
const { source, clips } = readSourceDir(DIR)
const built = buildPack(source, clips)
const corpus = loadCorpus([built.pack])
const pool = [...corpus.entries.values()]

describe('the A1 Bulgarian sample pack', () => {
  it('is committed byte for byte as the build produces it', () => {
    const committed = readFileSync(join(DIR, built.packFile))
    expect(committed.equals(Buffer.from(built.packBytes))).toBe(true)
    expect(JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'))).toEqual(built.manifest)
  })

  it('validates from disk and is version 0 of the Bulgarian corpus pack', () => {
    const result = validatePack(JSON.parse(readFileSync(join(DIR, built.packFile), 'utf8')))
    expect(result.status).toBe('ok')
    expect(built.pack.pack_id).toBe('corpus-bg')
    expect(built.pack.corpus_version).toBe(0)
    expect(built.packFile).toBe('corpus-v0-bg.pack')
  })

  it('has 60 A1 entries in three units of 20, 24 themes and a UK clip for every entry', () => {
    expect(pool).toHaveLength(60)
    expect(corpus.units.map((u) => u.wordIds.length)).toEqual([20, 20, 20])
    expect(corpus.themes).toHaveLength(24)
    expect(corpus.clips.size).toBe(60)
    for (const e of pool) {
      expect(e.level).toBe('A1')
      expect(e.retired).toBe(false)
      expect(e.examples.length).toBeGreaterThan(0)
      expect(corpus.clips.has(e.audio.uk ?? '')).toBe(true)
    }
    for (const clip of corpus.clips.values()) expect(clip.bytes).toBeGreaterThan(1000)
  })

  it('offers exactly the themes that reach the minimum size', () => {
    expect(offeredThemes(corpus).map((t) => t.themeId)).toEqual(['daily-life'])
    expect(themeEntries(corpus, 'daily-life')).toHaveLength(25)
    expect(themeEntries(corpus, 'food')).toHaveLength(20)
  })

  it('has no two entries sharing a translation, so no demo distractor is ambiguous', () => {
    // The same normalisation the distractor rule applies (case, NFC, trim).
    const norm = (s: string) => s.trim().normalize('NFC').toLowerCase()
    const seen = new Map<string, string>()
    for (const e of pool) {
      for (const t of e.translations.map(norm)) {
        expect(seen.get(t), `${t} in ${e.entryId} and ${seen.get(t)}`).toBeUndefined()
        seen.set(t, e.entryId)
      }
    }
  })

  it('gives every entry three distractors and fills a matching board', () => {
    const encountered = new Set<WordId>()
    for (const e of pool) {
      expect(pickDistractors(e, { pool, encountered, listening: false }, 3, seededRng(1))).toHaveLength(3)
      expect(pickDistractors(e, { pool, encountered, listening: true }, 3, seededRng(2))).toHaveLength(3)
    }
    expect(buildMatchingBoard(pool, 5, seededRng(3))).toHaveLength(5)
  })
})
