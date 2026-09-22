import { describe, expect, it } from 'vitest'
import type { Pack, PackEntry, PackUnit } from './pack'
import { checkPackSuccession } from './packStability'

function entry(entry_id: string, unit_id: string, retired = false): PackEntry {
  return {
    entry_id,
    headword: entry_id.replace(/-\d+$/, ''),
    variants: [],
    pos: 'noun',
    sense: '',
    ipa: 'x',
    level: 'A1',
    unit_id,
    themes: [],
    translation: entry_id,
    alternates: [],
    examples: ['An example.'],
    audio: {},
    retired,
  }
}

const unit = (unit_id: string, order: number, entry_ids: string[]): PackUnit => ({
  unit_id,
  level: 'A1',
  order,
  title: { en: unit_id, l1: unit_id },
  entry_ids,
})

const v0: Pack = {
  schema_version: 1,
  pack_id: 'corpus-bg',
  corpus_version: 0,
  l1: 'bg',
  target: 'en',
  entries: [entry('hello-1', 'a1-01'), entry('water-1', 'a1-01')],
  units: [unit('a1-01', 1, ['hello-1', 'water-1'])],
  themes: [],
  audio: [],
}

const messages = (errors: { message: string }[]) => errors.map((e) => e.message)

describe('checkPackSuccession', () => {
  it('accepts a version that keeps every ID and grows', () => {
    const v1: Pack = {
      ...v0,
      corpus_version: 1,
      entries: [...v0.entries, entry('bread-1', 'a1-02')],
      units: [...v0.units, unit('a1-02', 2, ['bread-1'])],
    }
    expect(checkPackSuccession(v0, v1)).toEqual([])
  })

  it('accepts a retired entry, a moved entry and an un-retired entry', () => {
    const retired: Pack = { ...v0, corpus_version: 1, entries: [entry('hello-1', 'a1-01', true), v0.entries[1]!] }
    expect(checkPackSuccession(v0, retired)).toEqual([])
    expect(checkPackSuccession(retired, { ...v0, corpus_version: 2 })).toEqual([])
    const moved: Pack = {
      ...v0,
      corpus_version: 1,
      entries: [v0.entries[0]!, entry('water-1', 'a1-02')],
      units: [unit('a1-01', 1, ['hello-1']), unit('a1-02', 2, ['water-1'])],
    }
    expect(checkPackSuccession(v0, moved)).toEqual([])
  })

  it('rejects a removed entry or unit', () => {
    const dropped: Pack = { ...v0, corpus_version: 1, entries: [v0.entries[0]!], units: [unit('a1-01', 1, ['hello-1'])] }
    expect(messages(checkPackSuccession(v0, dropped))).toEqual(['entry water-1 was removed; retire it instead'])
    const renamedUnit: Pack = {
      ...v0,
      corpus_version: 1,
      entries: v0.entries.map((e) => ({ ...e, unit_id: 'a1-1' })),
      units: [unit('a1-1', 1, ['hello-1', 'water-1'])],
    }
    expect(messages(checkPackSuccession(v0, renamedUnit))).toEqual(['unit a1-01 was removed'])
  })

  it('rejects a version that does not rise, a schema that goes back, or another pack', () => {
    expect(checkPackSuccession(v0, v0).map((e) => e.path)).toEqual(['corpus_version'])
    expect(checkPackSuccession({ ...v0, schema_version: 2 }, { ...v0, corpus_version: 1 }).map((e) => e.path)).toEqual(['schema_version'])
    expect(checkPackSuccession(v0, { ...v0, corpus_version: 1, pack_id: 'corpus-es', l1: 'es' }).map((e) => e.path)).toEqual(['pack_id', 'l1'])
  })
})
