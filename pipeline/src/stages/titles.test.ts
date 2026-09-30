import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cacheKey, StageCache } from '../cache'
import { fakeLlm } from '../llm'
import { titleUnits } from './titles'

const run = (answer: (n: string, i: unknown) => unknown) => ({
  llm: fakeLlm(answer),
  cache: StageCache.open(join(mkdtempSync(join(tmpdir(), 'titles-')), 'titles.jsonl')),
  concurrency: 1,
  offline: false,
})

const shared = () => join(mkdtempSync(join(tmpdir(), 'titles-')), 'titles.jsonl')
const on = (file: string, answer: (n: string, i: unknown) => unknown) => ({ llm: fakeLlm(answer), cache: StageCache.open(file), concurrency: 1, offline: false })
const perL1 = (_: string, input: unknown) => {
  const { l1s, units } = input as { l1s: string[]; units: { unit: string }[] }
  return { items: units.map((u) => ({ unit: u.unit, en: l1s[0] === 'bg' ? 'Food' : 'Eating', ...Object.fromEntries(l1s.map((l) => [l, l === 'bg' ? 'Храна' : 'Essen'])) })) }
}

describe('titleUnits', () => {
  it('names each unit in English and every L1', async () => {
    const out = await titleUnits([{ unit_id: 'a1-04', level: 'A1', words: ['bread', 'milk'] }], ['bg'], run(() => ({ items: [{ unit: 'a1-04', en: ' Food ', bg: 'Храна' }] })))
    expect(out.get('a1-04')).toEqual({ bg: { en: 'Food', l1: 'Храна' } })
  })

  it('rejects a response that answers other items than it was asked, or leaves an L1 empty', async () => {
    const units = [{ unit_id: 'a1-04', level: 'A1' as const, words: ['bread'] }]
    await expect(titleUnits(units, ['bg'], run(() => ({ items: [{ unit: 'a1-05', en: 'x', bg: 'y' }] })))).rejects.toThrow(/answers other items/)
    await expect(titleUnits(units, ['bg'], run(() => ({ items: [{ unit: 'a1-04', en: 'x', bg: ' ' }] })))).rejects.toThrow(/bg title/)
  })

  it('keeps the Bulgarian cache key of the single-L1 pipeline, so adding German asks German only', async () => {
    const file = shared()
    const units = [{ unit_id: 'a1-04', level: 'A1' as const, words: ['milk', 'bread'] }]
    await titleUnits(units, ['bg'], on(file, perL1))
    // The key a Bulgarian-only draft wrote before this plan.
    expect(StageCache.open(file).has(cacheKey('titles', 1, { level: 'A1', words: ['bread', 'milk'], l1s: ['bg'] }))).toBe(true)
    const r = on(file, perL1)
    const out = await titleUnits(units, ['bg', 'de'], r)
    expect(r.llm.calls.map((c) => (c.input as { l1s: string[] }).l1s)).toEqual([['de']])
    // One English title for every L1: the lead's.
    expect(out.get('a1-04')).toEqual({ bg: { en: 'Food', l1: 'Храна' }, de: { en: 'Food', l1: 'Essen' } })
  })
})
