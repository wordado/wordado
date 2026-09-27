import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StageCache } from '../cache'
import { fakeLlm } from '../llm'
import { lemmatise, rankLemmas, type LemmaResult } from './lemmas'

const cache = () => StageCache.open(join(mkdtempSync(join(tmpdir(), 'lemmas-')), 'lemmas.jsonl'))
const forms = [
  { form: 'went', perMillion: 300, rank: 1 },
  { form: 'saw', perMillion: 200, rank: 2 },
  { form: 'london', perMillion: 100, rank: 3 },
  { form: 'go', perMillion: 100, rank: 4 },
]
const LEXICON: Record<string, LemmaResult> = {
  went: { form: 'went', kind: 'word', lemmas: ['go'] },
  saw: { form: 'saw', kind: 'word', lemmas: ['see', 'saw'] },
  london: { form: 'london', kind: 'name', lemmas: [] },
  go: { form: 'go', kind: 'word', lemmas: ['Go '] },
}
const answer = (_name: string, input: unknown) => ({ items: (input as { forms: string[] }).forms.map((f) => LEXICON[f]) })

describe('lemmatise', () => {
  it('asks for every form once and normalises the lemmas it gets back', async () => {
    const llm = fakeLlm(answer)
    const run = { llm, cache: cache(), concurrency: 2, offline: false }
    const out = await lemmatise(forms, run)
    expect(out[3]).toEqual({ form: 'go', kind: 'word', lemmas: ['go'] })
    expect(llm.calls.map((c) => c.name)).toEqual(['lemmas'])
    await lemmatise(forms, run)
    expect(llm.calls).toHaveLength(1)
  })

  it('rejects a response that answers other items than it was asked', async () => {
    const llm = fakeLlm(() => ({ items: [LEXICON['saw'], LEXICON['went'], LEXICON['london'], LEXICON['go']] }))
    await expect(lemmatise(forms, { llm, cache: cache(), concurrency: 1, offline: false })).rejects.toThrow(/answers other items/)
  })
})

describe('rankLemmas', () => {
  it('sums each lemma over its forms, splitting a form among its lemmas, and drops non-words', () => {
    const results = forms.map((f) => ({ ...LEXICON[f.form]!, lemmas: LEXICON[f.form]!.lemmas.map((l) => l.trim().toLowerCase()) }))
    expect(rankLemmas(forms, results, [], 10)).toEqual([
      { lemma: 'go', perMillion: 400, rank: 1, pinned: false },
      { lemma: 'saw', perMillion: 100, rank: 2, pinned: false },
      { lemma: 'see', perMillion: 100, rank: 3, pinned: false },
    ])
  })

  it('keeps pinned headwords past the cut, and adds any the lists lack', () => {
    const results = forms.map((f) => ({ ...LEXICON[f.form]!, lemmas: LEXICON[f.form]!.lemmas.map((l) => l.trim().toLowerCase()) }))
    expect(rankLemmas(forms, results, ['see', 'thank you'], 1)).toEqual([
      { lemma: 'go', perMillion: 400, rank: 1, pinned: false },
      { lemma: 'see', perMillion: 100, rank: 3, pinned: true },
      { lemma: 'thank you', perMillion: 0, rank: 4, pinned: true },
    ])
  })
})
