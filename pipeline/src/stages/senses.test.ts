import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StageCache } from '../cache'
import { fakeLlm } from '../llm'
import { bandLevel, describeLemmas, frequencyBand } from './senses'

const run = (answer: (n: string, i: unknown) => unknown) => ({
  llm: fakeLlm(answer),
  cache: StageCache.open(join(mkdtempSync(join(tmpdir(), 'senses-')), 'senses.jsonl')),
  concurrency: 1,
  offline: false,
})
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

describe('bandLevel (Decision 7)', () => {
  it('keeps the LLM level within one band of frequency', () => {
    expect(bandLevel('A2', 'A1')).toEqual({ level: 'A2', flagged: false })
    expect(bandLevel('B1', 'B1')).toEqual({ level: 'B1', flagged: false })
  })
  it('clamps a level more than one band away, and flags it for banding review', () => {
    expect(bandLevel('B2', 'A1')).toEqual({ level: 'A2', flagged: true })
    expect(bandLevel('A1', 'B2')).toEqual({ level: 'B1', flagged: true })
  })
  it('drops C2, which no Phase 1 path teaches', () => {
    expect(bandLevel('C2', 'A1')).toEqual({ level: null, flagged: false })
  })
})
