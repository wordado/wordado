import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StageCache } from '../cache'
import { fakeLlm } from '../llm'
import { L1_GUIDES, mergeSenses, translateSenses } from './translate'

const run = (answer: (n: string, i: unknown) => unknown) => ({
  llm: fakeLlm(answer),
  cache: StageCache.open(join(mkdtempSync(join(tmpdir(), 'translate-')), 'translate.jsonl')),
  concurrency: 1,
  offline: false,
})
const items = [{ headword: 'water', pos: 'noun' as const, gloss: '', example: 'Water, please.' }]

describe('translateSenses', () => {
  it('trims, drops alternates equal to the primary or to each other, and keeps at most four', async () => {
    const out = await translateSenses('bg', items, run(() => ({
      items: [{ key: '0', translation: ' вода ', alternates: ['Вода', 'водичка', 'водичка', 'a', 'b', 'c', 'd'], sense: '' }],
    })))
    expect(out).toEqual([{ translation: 'вода', alternates: ['водичка', 'a', 'b', 'c'], sense: '' }])
  })

  it('sends the L1’s guide with the request, and refuses an L1 without one', async () => {
    const r = run(() => ({ items: [{ key: '0', translation: 'вода', alternates: [], sense: '' }] }))
    await translateSenses('bg', items, r)
    expect((r.llm as ReturnType<typeof fakeLlm>).calls[0]!.input).toMatchObject({ l1: 'bg' })
    expect(L1_GUIDES['bg']).toMatch(/Bulgarian/)
    await expect(translateSenses('xx', items, r)).rejects.toThrow(/no translation guide for xx/)
  })

  it('has a German guide: nouns without the article, verbs in the infinitive', () => {
    expect(L1_GUIDES['de']).toMatch(/German/)
    expect(L1_GUIDES['de']).toMatch(/without the article/)
    expect(L1_GUIDES['de']).toMatch(/infinitive/)
  })

  it('rejects a response that answers other items than it was asked', async () => {
    await expect(translateSenses('bg', items, run(() => ({ items: [{ key: '1', translation: 'вода', alternates: [], sense: '' }] })))).rejects.toThrow(/answers other items/)
  })

  it('rejects an empty primary translation', async () => {
    await expect(translateSenses('bg', items, run(() => ({ items: [{ key: '0', translation: ' ', alternates: [], sense: '' }] })))).rejects.toThrow(/empty translation/)
  })
})

describe('mergeSenses (Decision 8)', () => {
  const t = (translation: string) => ({ translation, alternates: [], sense: '' })
  const s = (gloss: string, bg: string, es?: string) => ({ headword: 'bank', pos: 'noun', gloss, l1: es ? { bg: t(bg), es: t(es) } : { bg: t(bg) } })
  const two = (gloss: string, bg: string, de: { translation: string; alternates?: string[] }) => ({
    headword: 'bank',
    pos: 'noun',
    gloss,
    l1: { bg: { translation: bg, alternates: [], sense: '' }, de: { translation: de.translation, alternates: de.alternates ?? [], sense: '' } },
  })

  it('merges senses whose primary translations agree, keeping the first', () => {
    expect(mergeSenses([s('money', 'банка'), s('building', 'Банка '), s('river', 'бряг')], ['bg']).map((x) => x.gloss)).toEqual(['money', 'river'])
  })

  it('merges on the lead L1 even when another L1 differs, folding its word into alternates', () => {
    const out = mergeSenses([s('money', 'банка', 'banco'), s('building', 'банка', 'sucursal')], ['bg', 'es'])
    expect(out).toHaveLength(1)
    expect(out[0]!.l1['es']).toEqual({ translation: 'banco', alternates: ['sucursal'], sense: '' })
  })

  it('never merges across parts of speech', () => {
    expect(mergeSenses([s('money', 'банка'), { ...s('', 'банка'), pos: 'verb' }], ['bg'])).toHaveLength(2)
  })

  it('merges on the lead L1 only; another L1’s other words become alternates of the kept sense', () => {
    const out = mergeSenses([two('money', 'банка', { translation: 'Bank' }), two('building', 'банка', { translation: 'Bankgebäude', alternates: ['Bank'] }), two('river', 'бряг', { translation: 'Ufer' })], ['bg', 'de'])
    expect(out.map((x) => x.gloss)).toEqual(['money', 'river'])
    expect(out[0]!.l1['de']).toEqual({ translation: 'Bank', alternates: ['Bankgebäude'], sense: '' })
    expect(out[0]!.l1['bg']).toEqual({ translation: 'банка', alternates: [], sense: '' })
  })

  it('never lets a later L1 split senses the lead L1 merged', () => {
    const one = mergeSenses([two('money', 'банка', { translation: 'Bank' }), two('building', 'банка', { translation: 'Gebäude' })], ['bg'])
    const both = mergeSenses([two('money', 'банка', { translation: 'Bank' }), two('building', 'банка', { translation: 'Gebäude' })], ['bg', 'de'])
    expect(both.map((x) => x.gloss)).toEqual(one.map((x) => x.gloss))
  })

  it('keeps at most four alternates', () => {
    const out = mergeSenses(
      [two('a', 'x', { translation: 'eins', alternates: ['zwei', 'drei', 'vier'] }), two('b', 'x', { translation: 'fünf', alternates: ['sechs'] })],
      ['bg', 'de'],
    )
    expect(out[0]!.l1['de']!.alternates).toEqual(['zwei', 'drei', 'vier', 'fünf'])
  })
})
