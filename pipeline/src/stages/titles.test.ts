import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StageCache } from '../cache'
import { fakeLlm } from '../llm'
import { titleUnits } from './titles'

const run = (answer: (n: string, i: unknown) => unknown) => ({
  llm: fakeLlm(answer),
  cache: StageCache.open(join(mkdtempSync(join(tmpdir(), 'titles-')), 'titles.jsonl')),
  concurrency: 1,
  offline: false,
})

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
})
