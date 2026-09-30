import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
import { readSourceDir, writeArtifacts } from './fs'

const DIR = fileURLToPath(new URL('../samples/a1/', import.meta.url))
const { sources, clips } = readSourceDir(DIR)
const built = sources.map((source) => buildPack(source, clips))
const bgOut = built.find((o) => o.pack.l1 === 'bg')!
const deOut = built.find((o) => o.pack.l1 === 'de')!
const corpus = loadCorpus([bgOut.pack])
const pool = [...corpus.entries.values()]

describe('the A1 Bulgarian sample pack', () => {
  it('is committed byte for byte as the build produces it', () => {
    const committed = readFileSync(join(DIR, bgOut.packFile))
    expect(committed.equals(Buffer.from(bgOut.packBytes))).toBe(true)
  })

  it('validates from disk and is version 0 of the Bulgarian corpus pack', () => {
    const result = validatePack(JSON.parse(readFileSync(join(DIR, bgOut.packFile), 'utf8')))
    expect(result.status).toBe('ok')
    expect(bgOut.pack.pack_id).toBe('corpus-bg')
    expect(bgOut.pack.corpus_version).toBe(0)
    expect(bgOut.packFile).toBe('corpus-v0-bg.pack')
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

describe('the A1 German sample pack (plan 10)', () => {
  it('is committed byte for byte as the build produces it, and validates as version 0 of the German corpus pack', () => {
    const committed = readFileSync(join(DIR, deOut.packFile))
    expect(committed.equals(Buffer.from(deOut.packBytes))).toBe(true)
    const result = validatePack(JSON.parse(readFileSync(join(DIR, deOut.packFile), 'utf8')))
    expect(result.status).toBe('ok')
    expect(deOut.pack.pack_id).toBe('corpus-de')
    expect(deOut.pack.corpus_version).toBe(0)
    expect(deOut.packFile).toBe('corpus-v0-de.pack')
  })

  it('shares the same entry IDs, units and audio as the Bulgarian pack', () => {
    expect(deOut.pack.entries.map((e) => e.entry_id).sort()).toEqual(bgOut.pack.entries.map((e) => e.entry_id).sort())
    expect(deOut.pack.units.map((u) => [u.unit_id, u.entry_ids])).toEqual(bgOut.pack.units.map((u) => [u.unit_id, u.entry_ids]))
    expect(deOut.pack.audio.map((a) => a.clip_id).sort()).toEqual(bgOut.pack.audio.map((a) => a.clip_id).sort())
  })

  it('translates hello-1 as hallo', () => {
    expect(deOut.pack.entries.find((e) => e.entry_id === 'hello-1')?.translation).toBe('hallo')
  })
})

describe('the sample manifest (plan 10)', () => {
  it('lists both packs at version 0', () => {
    const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { packs: { pack_id: string; l1: string; corpus_version: number }[] }
    expect(manifest.packs.map((p) => [p.pack_id, p.l1, p.corpus_version]).sort()).toEqual([
      ['corpus-bg', 'bg', 0],
      ['corpus-de', 'de', 0],
    ])
    expect(manifest).toEqual({
      schema_version: bgOut.manifest.schema_version,
      corpus_version: 0,
      packs: [...bgOut.manifest.packs, ...deOut.manifest.packs].sort((a, b) => (a.l1 < b.l1 ? -1 : 1)),
    })
  })

  it('rebuilds byte for byte from a copy of the folder', () => {
    const copy = join(mkdtempSync(join(tmpdir(), 'sample-')), 'a1')
    cpSync(DIR, copy, { recursive: true })
    const { sources: sources2, clips: clips2 } = readSourceDir(copy)
    const outs = sources2.map((source) => buildPack(source, clips2))
    writeArtifacts(copy, outs)
    for (const out of outs) expect(readFileSync(join(copy, out.packFile))).toEqual(Buffer.from(out.packBytes))
    expect(JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8'))).toEqual(JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')))
  })
})
