import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  type Pack,
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
const esOut = built.find((o) => o.pack.l1 === 'es')!
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

describe('the A1 Spanish sample pack (plan 12)', () => {
  it('is committed byte for byte as the build produces it, and validates as version 0 of the Spanish corpus pack', () => {
    expect(esOut).toBeDefined()
    const committed = readFileSync(join(DIR, esOut.packFile))
    expect(committed.equals(Buffer.from(esOut.packBytes))).toBe(true)
    const result = validatePack(JSON.parse(readFileSync(join(DIR, esOut.packFile), 'utf8')))
    expect(result.status).toBe('ok')
    expect(esOut.pack.pack_id).toBe('corpus-es')
    expect(esOut.pack.corpus_version).toBe(0)
    expect(esOut.packFile).toBe('corpus-v0-es.pack')
  })

  it('shares the same entry IDs, units, themes and audio as the Bulgarian pack', () => {
    expect(esOut.pack.entries.map((e) => e.entry_id).sort()).toEqual(bgOut.pack.entries.map((e) => e.entry_id).sort())
    expect(esOut.pack.units.map((u) => [u.unit_id, u.entry_ids])).toEqual(bgOut.pack.units.map((u) => [u.unit_id, u.entry_ids]))
    expect(esOut.pack.themes.map((t) => t.theme_id)).toEqual(bgOut.pack.themes.map((t) => t.theme_id))
    expect(esOut.pack.audio.map((a) => a.clip_id).sort()).toEqual(bgOut.pack.audio.map((a) => a.clip_id).sort())
  })

  it('translates hello-1 as hola and titles the first unit in Spanish', () => {
    expect(esOut.pack.entries.find((e) => e.entry_id === 'hello-1')?.translation).toBe('hola')
    expect(esOut.pack.units.map((u) => u.title.l1)).toEqual(['Personas y saludos', 'Comida y bebida', 'En casa y en el día a día'])
  })

  it('gives every entry three distractors and fills a matching board, though alternates are shared across entries', () => {
    const esPool = [...loadCorpus([esOut.pack]).entries.values()]
    const encountered = new Set<WordId>()
    for (const e of esPool) {
      expect(pickDistractors(e, { pool: esPool, encountered, listening: false }, 3, seededRng(1))).toHaveLength(3)
      expect(pickDistractors(e, { pool: esPool, encountered, listening: true }, 3, seededRng(2))).toHaveLength(3)
    }
    expect(buildMatchingBoard(esPool, 5, seededRng(3))).toHaveLength(5)
  })
})

const DE_DIR = join(DIR, 'de')

describe('the A1 German course sample (#313)', () => {
  // Built exactly as the CLI's `build` builds a folder; the German course has no audio yet, so no `audio/` folder.
  const { sources: deSources, clips: deClips } = readSourceDir(DE_DIR)
  const deBuilt = deSources.map((source) => buildPack(source, deClips))
  const readPack = (file: string): Pack => {
    const result = validatePack(JSON.parse(readFileSync(join(DE_DIR, file), 'utf8')))
    if (result.status !== 'ok') throw new Error(`${file} does not validate`)
    return result.pack
  }

  it('builds one pack per L1, Bulgarian and English, with no clips', () => {
    expect(deClips).toEqual([])
    expect(deBuilt.map((o) => [o.pack.pack_id, o.pack.l1, o.pack.target, o.packFile])).toEqual([
      ['corpus-de-bg', 'bg', 'de', 'corpus-v0-bg.pack'],
      ['corpus-de-en', 'en', 'de', 'corpus-v0-en.pack'],
    ])
  })

  for (const l1 of ['bg', 'en']) {
    it(`is committed byte for byte as the build produces it (${l1})`, () => {
      const out = deBuilt.find((o) => o.pack.l1 === l1)!
      expect(readFileSync(join(DE_DIR, out.packFile)).equals(Buffer.from(out.packBytes))).toBe(true)
      expect(out.pack.audio).toEqual([])
      expect(out.manifest.packs[0]?.target).toBe('de')
    })
  }

  it('has a manifest listing both packs as the build writes it', () => {
    const manifest = JSON.parse(readFileSync(join(DE_DIR, 'manifest.json'), 'utf8')) as unknown
    expect(manifest).toEqual({
      schema_version: deBuilt[0]!.manifest.schema_version,
      corpus_version: 0,
      packs: deBuilt.flatMap((o) => o.manifest.packs),
    })
  })

  it('is a German course: prefixed IDs, grammar on every noun and verb, two units of 20', () => {
    const pack = readPack('corpus-v0-bg.pack')
    expect(pack.target).toBe('de')
    expect(pack.pack_id).toBe('corpus-de-bg')
    expect(pack.entries).toHaveLength(40)
    expect(pack.entries.every((e) => e.entry_id.startsWith('de.'))).toBe(true)
    expect(pack.units.map((u) => [u.unit_id, u.entry_ids.length])).toEqual([['de.a1-01', 20], ['de.a1-02', 20]])
    expect(pack.entries.filter((e) => e.pos === 'noun' || e.pos === 'verb').every((e) => e.grammar !== undefined)).toBe(true)
    expect(pack.entries.filter((e) => e.pos === 'noun')).toHaveLength(24)
    expect(pack.entries.filter((e) => e.pos === 'verb')).toHaveLength(10)
    expect(pack.themes.map((t) => t.theme_id)).toEqual(bgOut.pack.themes.map((t) => t.theme_id))
    expect(pack.entries.find((e) => e.entry_id === 'de.maedchen-1')?.grammar).toEqual({ gender: 'n', plural: 'Mädchen' })
    expect(pack.entries.find((e) => e.entry_id === 'de.aufstehen-1')?.grammar).toEqual({ separable: true, irregular: true, auxiliary: 'sein' })
  })

  it('has the same entries, units and grammar in both packs, and only the translations differ', () => {
    const [bg, en] = [readPack('corpus-v0-bg.pack'), readPack('corpus-v0-en.pack')]
    const strip = (p: Pack) => p.entries.map((e) => ({ ...e, translation: '', alternates: [] }))
    expect(strip(en)).toEqual(strip(bg))
    expect(en.units.map((u) => [u.unit_id, u.entry_ids, u.title.en])).toEqual(bg.units.map((u) => [u.unit_id, u.entry_ids, u.title.en]))
    expect(en.units.every((u) => u.title.l1 === u.title.en)).toBe(true)
  })

  for (const l1 of ['bg', 'en']) {
    it(`has no two entries sharing a translation (${l1})`, () => {
      const norm = (s: string) => s.trim().normalize('NFC').toLowerCase()
      const seen = new Map<string, string>()
      for (const e of loadCorpus([readPack(`corpus-v0-${l1}.pack`)]).entries.values()) {
        for (const t of e.translations.map(norm)) {
          expect(seen.get(t), `${t} in ${e.entryId} and ${seen.get(t)}`).toBeUndefined()
          seen.set(t, e.entryId)
        }
      }
    })

    it(`gives every entry three distractors and fills a matching board (${l1})`, () => {
      const dePool = [...loadCorpus([readPack(`corpus-v0-${l1}.pack`)]).entries.values()]
      const encountered = new Set<WordId>()
      for (const e of dePool) {
        expect(pickDistractors(e, { pool: dePool, encountered, listening: false }, 3, seededRng(1))).toHaveLength(3)
        expect(pickDistractors(e, { pool: dePool, encountered, listening: true }, 3, seededRng(2))).toHaveLength(3)
      }
      expect(buildMatchingBoard(dePool, 5, seededRng(3))).toHaveLength(5)
    })
  }
})

describe('the sample manifest (plan 10)', () => {
  it('lists the three packs at version 0', () => {
    const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { packs: { pack_id: string; l1: string; corpus_version: number }[] }
    expect(manifest.packs.map((p) => [p.pack_id, p.l1, p.corpus_version]).sort()).toEqual([
      ['corpus-bg', 'bg', 0],
      ['corpus-de', 'de', 0],
      ['corpus-es', 'es', 0],
    ])
    expect(manifest).toEqual({
      schema_version: bgOut.manifest.schema_version,
      corpus_version: 0,
      packs: [...bgOut.manifest.packs, ...deOut.manifest.packs, ...esOut.manifest.packs].sort((a, b) => (a.l1 < b.l1 ? -1 : 1)),
    })
  })

  it('rebuilds byte for byte from a copy of the folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'sample-'))
    try {
      const copy = join(root, 'a1')
      cpSync(DIR, copy, { recursive: true })
      const { sources: sources2, clips: clips2 } = readSourceDir(copy)
      const outs = sources2.map((source) => buildPack(source, clips2))
      writeArtifacts(copy, outs)
      // Rebuilding into the copy must reproduce exactly what is committed in DIR, not just be internally consistent.
      for (const out of outs) expect(readFileSync(join(copy, out.packFile))).toEqual(readFileSync(join(DIR, out.packFile)))
      expect(JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8'))).toEqual(JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
