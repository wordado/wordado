import type { Pack, PackEntry } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { diffFixes, nextFixesFile } from './fixes'

const e = (extra: Partial<PackEntry> = {}): PackEntry => ({
  entry_id: 'water-1', headword: 'water', variants: [], pos: 'noun', sense: '', ipa: 'x', level: 'A1', unit_id: 'a1-01', themes: [],
  translation: 'вода', alternates: [], examples: ['Water.'], audio: { uk: 'water-1-uk-1' }, retired: false, ...extra,
})
const pack = (v: number, entries: PackEntry[]) => ({ corpus_version: v, entries }) as unknown as Pack

describe('diffFixes', () => {
  it('names each changed field of an entry both versions carry, as a report field', () => {
    const before = pack(1, [e(), e({ entry_id: 'new-1' })])
    const after = pack(2, [e({ alternates: ['водичка'], examples: ['Water, please.'], audio: { uk: 'water-1-uk-2' }, level: 'A2' }), e({ entry_id: 'brand-1' })])
    expect(diffFixes(before, after)).toEqual([
      { word_id: 'c:water-1', field: 'audio', fixed_in: 2 },
      { word_id: 'c:water-1', field: 'example', fixed_in: 2 },
      { word_id: 'c:water-1', field: 'level', fixed_in: 2 },
      { word_id: 'c:water-1', field: 'translation', fixed_in: 2 },
    ])
  })

  it('counts a changed sense gloss as a translation fix, and nothing for an unchanged entry', () => {
    expect(diffFixes(pack(1, [e()]), pack(2, [e({ sense: 'питейна' })]))).toEqual([{ word_id: 'c:water-1', field: 'translation', fixed_in: 2 }])
    expect(diffFixes(pack(1, [e()]), pack(2, [e()]))).toEqual([])
    expect(diffFixes(null, pack(1, [e()]))).toEqual([])
  })
})

describe('nextFixesFile', () => {
  it('keeps every earlier fix and adds the new ones', () => {
    const prev = { schema_version: 1 as const, corpus_version: 1, fixes: [{ word_id: 'c:a-1', field: 'audio' as const, fixed_in: 1 }] }
    expect(nextFixesFile(prev, [{ word_id: 'c:b-1', field: 'level', fixed_in: 2 }], 2)).toEqual({
      schema_version: 1,
      corpus_version: 2,
      fixes: [{ word_id: 'c:a-1', field: 'audio', fixed_in: 1 }, { word_id: 'c:b-1', field: 'level', fixed_in: 2 }],
    })
  })
})
