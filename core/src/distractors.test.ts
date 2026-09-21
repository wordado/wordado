import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildMatchingBoard, isValidDistractor, pickDistractors, type DistractorContext } from './distractors'
import { seededRng } from './rng'
import type { CefrLevel, CorpusEntry } from './types'
import { corpusWordId, type WordId } from './wordId'

let n = 0
function entry(headword: string, translations: string[], over: Partial<CorpusEntry> = {}): CorpusEntry {
  n += 1
  return {
    entryId: `en-${String(n).padStart(6, '0')}`,
    headword,
    pos: 'adjective',
    level: 'A1',
    ipa: `/${headword}/`,
    unitId: 'a1-u1',
    themes: [],
    translations,
    retired: false,
    ...over,
  }
}

const big = entry('big', ['голям'])
const large = entry('large', ['голям', 'едър'])
const small = entry('small', ['малък'])
const bad = entry('bad', ['лош'])
const hot = entry('hot', ['горещ'])
const cold = entry('cold', ['студен'])
const old = entry('old', ['стар'], { retired: true })
const bankMoney = entry('bank', ['банка'], { pos: 'noun' })
const bankRiver = entry('bank', ['бряг'], { pos: 'noun' })
const their = entry('their', ['техен'], { pos: 'determiner', ipa: '/ðeə/' })
const there = entry('there', ['там'], { pos: 'adverb', ipa: '/ðeə/' })
const POOL = [big, large, small, bad, hot, cold, old, bankMoney, bankRiver, their, there]

const ctx = (over: Partial<DistractorContext> = {}): DistractorContext => ({
  pool: POOL,
  encountered: new Set<WordId>(),
  listening: false,
  ...over,
})

describe('isValidDistractor', () => {
  it('excludes the target, retired entries, synonyms and other senses of the headword', () => {
    expect(isValidDistractor(big, big, false)).toBe(false)
    expect(isValidDistractor(big, old, false)).toBe(false)
    expect(isValidDistractor(big, large, false)).toBe(false)
    expect(isValidDistractor(bankMoney, bankRiver, false)).toBe(false)
    expect(isValidDistractor(big, small, false)).toBe(true)
  })

  it('compares translations case-insensitively, alternates included', () => {
    expect(isValidDistractor(entry('huge', ['Едър']), large, false)).toBe(false)
  })

  it('folds case and Unicode form the same way everywhere, whatever the host locale', () => {
    expect(isValidDistractor(entry('Irish', ['ирландски']), entry('irish', ['ирски']), false)).toBe(false)
    const precomposed = entry('fee', ['év']) // é
    const combining = entry('charge', ['év']) // e + combining acute
    expect(isValidDistractor(precomposed, combining, false)).toBe(false)
  })

  it('excludes homophones in listening modes only', () => {
    expect(isValidDistractor(their, there, true)).toBe(false)
    expect(isValidDistractor(their, there, false)).toBe(true)
  })
})

describe('pickDistractors', () => {
  it('returns the requested number of valid options', () => {
    const out = pickDistractors(big, ctx(), 3, seededRng(1))
    expect(out).toHaveLength(3)
    for (const d of out) expect(isValidDistractor(big, d, false)).toBe(true)
  })

  it('prefers the target’s band and part of speech', () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const out = pickDistractors(big, ctx(), 3, seededRng(seed))
      expect(out.every((d) => d.pos === 'adjective' && d.level === 'A1')).toBe(true)
    }
  })

  it('prefers words the learner has met, keyed by WordId as the caller holds them', () => {
    const encountered = new Set([corpusWordId(hot.entryId)])
    for (let seed = 0; seed < 25; seed += 1) {
      expect(pickDistractors(big, ctx({ encountered }), 1, seededRng(seed))).toEqual([hot])
    }
  })

  it('relaxes band and part of speech rather than coming up short', () => {
    const out = pickDistractors(their, ctx(), 3, seededRng(3))
    expect(out).toHaveLength(3)
  })

  it('returns what it can when the pool is too small', () => {
    expect(pickDistractors(big, ctx({ pool: [big, large, small] }), 3, seededRng(1))).toEqual([small])
  })

  it('varies between calls', () => {
    const seen = new Set<string>()
    for (let seed = 0; seed < 40; seed += 1) {
      seen.add(pickDistractors(big, ctx(), 3, seededRng(seed)).map((d) => d.headword).sort().join())
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('distractor invariants (spec §13)', () => {
  const tr = fc.constantFrom('а', 'б', 'в', 'г', 'д', 'е', 'ж', 'з', 'и', 'к', 'л', 'м')
  const entryArb = fc.record({
    headword: fc.constantFrom('ant', 'bat', 'cat', 'dog', 'eel', 'fox', 'gnu', 'hen', 'ibis', 'jay'),
    pos: fc.constantFrom('noun', 'verb'),
    level: fc.constantFrom<CefrLevel>('A1', 'A2'),
    ipa: fc.constantFrom('/a/', '/b/', '/c/', '/d/', '/e/', '/f/'),
    translations: fc.uniqueArray(tr, { minLength: 1, maxLength: 3 }),
    retired: fc.boolean(),
  })
  const poolArb = fc
    .array(entryArb, { minLength: 1, maxLength: 30 })
    .map((pool) => pool.map((e, i): CorpusEntry => ({ ...e, entryId: `e${i}`, unitId: 'u', themes: [] })))

  it('no distractor is ambiguous with its target or with another distractor', () => {
    fc.assert(
      fc.property(poolArb, fc.boolean(), fc.nat(), (pool, listening, seed) => {
        const target = pool[0]!
        const out = pickDistractors(target, { pool, encountered: new Set<WordId>(), listening }, 3, seededRng(seed))
        const shown = [target, ...out]
        for (const d of out) expect(d.retired).toBe(false)
        for (let i = 0; i < shown.length; i += 1) {
          for (let j = i + 1; j < shown.length; j += 1) {
            const a = shown[i]!
            const b = shown[j]!
            expect(a.headword).not.toBe(b.headword)
            expect(a.translations.filter((t) => b.translations.includes(t))).toEqual([])
            if (listening) expect(a.ipa).not.toBe(b.ipa)
          }
        }
      }),
    )
  })

  it('no two pairs on a matching board share a headword or a translation', () => {
    fc.assert(
      fc.property(poolArb, fc.nat(), (pool, seed) => {
        const board = buildMatchingBoard(pool, 5, seededRng(seed))
        if (board === null) return
        expect(board).toHaveLength(5)
        expect(new Set(board.map((e) => e.headword)).size).toBe(5)
        const all = board.flatMap((e) => e.translations)
        expect(new Set(all).size).toBe(all.length)
        expect(board.some((e) => e.retired)).toBe(false)
      }),
    )
  })
})

describe('buildMatchingBoard', () => {
  it('fills a board from unambiguous entries', () => {
    const board = buildMatchingBoard(POOL, 5, seededRng(5))
    expect(board).toHaveLength(5)
  })

  it('returns null when it cannot', () => {
    expect(buildMatchingBoard([big, large, small], 3, seededRng(5))).toBeNull()
  })
})
