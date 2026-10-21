import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StageCache } from '../cache'
import { fakeLlm } from '../llm'
import { PROFILES, type LanguageProfile } from '../profiles'
import { bandLevel, describeLemmas, frequencyBand } from './senses'

const runFor = (profile: LanguageProfile, answer: (n: string, i: unknown) => unknown) => ({
  llm: fakeLlm(answer),
  cache: StageCache.open(join(mkdtempSync(join(tmpdir(), 'senses-')), 'senses.jsonl')),
  concurrency: 1,
  offline: false,
  profile,
})
const run = (answer: (n: string, i: unknown) => unknown) => runFor(PROFILES.en, answer)
const bank = {
  lemma: 'bank',
  senses: [
    { pos: 'noun', gloss: 'money', level: 'A2', ipa: 'bæŋk', variants: [], themes: ['shopping', 'unknown-theme'], examples: ['I went to the bank.', 'The bank | shut.'] },
    { pos: 'noun', gloss: 'river', level: 'B1', ipa: 'bæŋk', variants: [], themes: [], examples: ['We sat on the river bank.'] },
  ],
}
const lemmas = [{ lemma: 'bank', perMillion: 50, rank: 900, pinned: false }]

describe('describeLemmas', () => {
  it('keeps known themes only and makes examples safe for the review sheet', async () => {
    const [senses] = await describeLemmas(lemmas, ['shopping'], run(() => ({ items: [bank] })))
    expect(senses).toEqual([
      { headword: 'bank', pos: 'noun', gloss: 'money', level: 'A2', ipa: 'bæŋk', variants: [], themes: ['shopping'], examples: ['I went to the bank.', 'The bank / shut.'] },
      { headword: 'bank', pos: 'noun', gloss: 'river', level: 'B1', ipa: 'bæŋk', variants: [], themes: [], examples: ['We sat on the river bank.'] },
    ])
  })

  it('rejects a response that answers other items than it was asked', async () => {
    await expect(describeLemmas(lemmas, [], run(() => ({ items: [{ ...bank, lemma: 'river' }] })))).rejects.toThrow(/answers other items/)
  })

  it('keeps a headword’s capitals, and ignores a "headword" that is another word', async () => {
    const pronoun = { lemma: 'i', headword: 'I', senses: [{ ...bank.senses[0], pos: 'pron', gloss: '' }] }
    const lemma = [{ lemma: 'i', perMillion: 9000, rank: 10, pinned: false }]
    expect((await describeLemmas(lemma, [], run(() => ({ items: [pronoun] }))))[0]![0]!.headword).toBe('I')
    expect((await describeLemmas(lemma, [], run(() => ({ items: [{ ...pronoun, headword: 'Me' }] }))))[0]![0]!.headword).toBe('i')
  })

  it('drops a variant that is only the headword in other capitals', async () => {
    const pronoun = { lemma: 'i', headword: 'I', senses: [{ ...bank.senses[0], pos: 'pron', gloss: '', variants: ['i', 'I'] }] }
    const lemma = [{ lemma: 'i', perMillion: 9000, rank: 10, pinned: false }]
    expect((await describeLemmas(lemma, [], run(() => ({ items: [pronoun] }))))[0]![0]!.variants).toEqual([])
  })

  it('rejects two senses of one part of speech that the gloss cannot tell apart', async () => {
    const same = { ...bank, senses: [bank.senses[0], { ...bank.senses[1], gloss: '' }] }
    await expect(describeLemmas(lemmas, [], run(() => ({ items: [same] })))).rejects.toThrow(/needs a gloss/)
  })

  it('rejects a live sense with no example sentence (spec §5.2)', async () => {
    const bare = { ...bank, senses: [{ ...bank.senses[0], examples: [' '] }] }
    await expect(describeLemmas(lemmas, [], run(() => ({ items: [bare] })))).rejects.toThrow(/example/)
  })
})

describe('frequencyBand (Decision 7)', () => {
  const targets = { A1: 600, A2: 1000, B1: 1500, B2: 2000, C1: 2000 }
  it('bands by rank against the cumulative targets', () => {
    expect([1, 600, 601, 1600, 1601, 3100, 3101, 5100, 7100, 9999].map((r) => frequencyBand(r, targets))).toEqual([
      'A1', 'A1', 'A2', 'A2', 'B1', 'B1', 'B2', 'B2', 'C1', 'C1',
    ])
  })
})

describe('bandLevel (Decision 7; two steps since 2026-10-06)', () => {
  it('keeps the LLM level when it is at most two bands from frequency', () => {
    expect(bandLevel('A2', 'A1')).toEqual({ level: 'A2', flagged: false })
    expect(bandLevel('B1', 'B1')).toEqual({ level: 'B1', flagged: false })
    expect(bandLevel('B1', 'A1')).toEqual({ level: 'B1', flagged: false })
    expect(bandLevel('A1', 'B1')).toEqual({ level: 'A1', flagged: false })
  })
  it('limits a level more than two bands away, and flags it for banding review', () => {
    expect(bandLevel('B2', 'A1')).toEqual({ level: 'B1', flagged: true })
    expect(bandLevel('C1', 'A1')).toEqual({ level: 'B1', flagged: true })
    expect(bandLevel('A1', 'B2')).toEqual({ level: 'A2', flagged: true })
    expect(bandLevel('A1', 'C1')).toEqual({ level: 'B1', flagged: true })
  })
  it('never leaves the scale at its ends', () => {
    expect(bandLevel('A1', 'A1')).toEqual({ level: 'A1', flagged: false })
    expect(bandLevel('C1', 'C1')).toEqual({ level: 'C1', flagged: false })
    expect(bandLevel('C1', 'B1')).toEqual({ level: 'C1', flagged: false })
  })
  it('drops C2, which no Phase 1 path teaches', () => {
    expect(bandLevel('C2', 'A1')).toEqual({ level: null, flagged: false })
  })
})

describe('describeLemmas for a target with grammar', () => {
  const german = (lemma: string, sense: Record<string, unknown>) => ({
    lemma,
    senses: [{ gloss: '', level: 'A1', ipa: 'x', variants: [], themes: [], examples: ['Ein Satz.'], ...sense }],
  })
  const deAnswer = () => ({
    items: [
      german('gehen', { pos: 'verb', grammar: { gender: '', plural: '', separable: false, irregular: true, auxiliary: 'sein' } }),
      german('haus', { pos: 'noun', grammar: { gender: 'n', plural: 'Häuser', separable: false, irregular: false, auxiliary: '' } }),
    ],
  })
  const ranked = (...names: string[]) => names.map((lemma, i) => ({ lemma, perMillion: 100, rank: i + 1, pinned: false }))

  it('keeps the grammar fields of each part of speech for German', async () => {
    const out = await describeLemmas(ranked('gehen', 'haus'), [], runFor(PROFILES.de, deAnswer))
    expect(out[0]![0]!.grammar).toEqual({ separable: false, irregular: true, auxiliary: 'sein' })
    expect(out[1]![0]!.grammar).toEqual({ gender: 'n', plural: 'Häuser' })
  })

  it('gives a part of speech without grammar fields no grammar block, and does not reject it', async () => {
    const answer = () => ({ items: [german('gut', { pos: 'adj', grammar: { gender: '', plural: '', separable: false, irregular: false, auxiliary: '' } })] })
    const out = await describeLemmas(ranked('gut'), [], runFor(PROFILES.de, answer))
    expect(out[0]![0]!.grammar).toBeUndefined()
  })

  it('rejects a German sense without a grammar object', async () => {
    const answer = () => ({ items: [german('gut', { pos: 'adj' })] })
    await expect(describeLemmas(ranked('gut'), [], runFor(PROFILES.de, answer))).rejects.toThrow(/gut sense 0: grammar must be an object/)
  })

  it('rejects a German noun without a gender and a verb without an auxiliary, so the stage asks again', async () => {
    const noun = () => ({ items: [german('haus', { pos: 'noun', grammar: { gender: '', plural: 'Häuser', separable: false, irregular: false, auxiliary: '' } })] })
    await expect(describeLemmas(ranked('haus'), [], runFor(PROFILES.de, noun))).rejects.toThrow(/haus sense 0: gender is missing/)
    const verb = () => ({ items: [german('gehen', { pos: 'verb', grammar: { gender: '', plural: '', separable: false, irregular: true, auxiliary: '' } })] })
    await expect(describeLemmas(ranked('gehen'), [], runFor(PROFILES.de, verb))).rejects.toThrow(/gehen sense 0: auxiliary is missing/)
    const bare = () => ({ items: [german('haus', { pos: 'noun', grammar: { gender: '' } })] })
    await expect(describeLemmas(ranked('haus'), [], runFor(PROFILES.de, bare))).rejects.toThrow(/haus sense 0: gender is missing; plural is missing/)
  })

  it('rejects a German grammar value of the wrong type', async () => {
    const bad = () => ({ items: [german('haus', { pos: 'noun', grammar: { gender: 'n', plural: 5, separable: false, irregular: false, auxiliary: '' } })] })
    await expect(describeLemmas(ranked('haus'), [], runFor(PROFILES.de, bad))).rejects.toThrow(/haus sense 0/)
  })

  it('asks English senses without grammar', async () => {
    const out = await describeLemmas(lemmas, [], runFor(PROFILES.en, () => ({ items: [bank] })))
    expect(out[0]![0]!.grammar).toBeUndefined()
  })
})
