import { describe, expect, it } from 'vitest'
import { entryClips, loadCorpus, MIN_THEME_SIZE, offeredThemes, themeEntries } from './corpus'
import type { Pack, PackEntry, PackUnit } from './pack'
import { corpusWordId } from './wordId'

const clip = (id: string) => ({ clip_id: id, url: `audio/${id}.m4a`, sha256: 'a'.repeat(64), bytes: 1000, mime: 'audio/mp4' })
const theme = (id: string) => ({ theme_id: id, name: { en: id, l1: id }, description: { en: id, l1: id } })

function entry(over: Partial<PackEntry> & Pick<PackEntry, 'entry_id' | 'unit_id'>): PackEntry {
  return {
    headword: over.entry_id.replace(/-\d+$/, ''),
    variants: [],
    pos: 'noun',
    sense: '',
    ipa: 'x',
    level: 'A1',
    themes: [],
    translation: over.entry_id,
    alternates: [],
    examples: ['An example.'],
    audio: {},
    retired: false,
    ...over,
  }
}

const unit = (unit_id: string, level: PackUnit['level'], order: number, entry_ids: string[]): PackUnit => ({
  unit_id,
  level,
  order,
  title: { en: unit_id, l1: unit_id },
  entry_ids,
})

function pack(over: Partial<Pack> = {}): Pack {
  return {
    schema_version: 1,
    pack_id: 'corpus-bg',
    corpus_version: 1,
    l1: 'bg',
    target: 'en',
    entries: [
      entry({ entry_id: 'water-1', unit_id: 'a1-02', themes: ['food'], translation: 'вода', alternates: ['водичка'], audio: { uk: 'water-1-uk' } }),
      entry({ entry_id: 'bread-1', unit_id: 'a1-02', themes: ['food'] }),
      entry({ entry_id: 'hello-1', unit_id: 'a1-01', pos: 'intj', themes: ['greetings'], audio: { uk: 'hello-1-uk', us: 'hello-1-us' } }),
      entry({ entry_id: 'bye-1', unit_id: 'a1-01', pos: 'intj', themes: ['greetings'], retired: true }),
    ],
    units: [unit('a1-02', 'A1', 2, ['bread-1', 'water-1']), unit('a1-01', 'A1', 1, ['hello-1', 'bye-1'])],
    themes: [theme('greetings'), theme('food')],
    audio: [clip('water-1-uk'), clip('hello-1-uk'), clip('hello-1-us')],
    ...over,
  }
}

describe('loadCorpus', () => {
  it('maps entries, units, themes and clips into the shapes the rules read', () => {
    const corpus = loadCorpus([pack()])
    expect(corpus.l1).toBe('bg')
    expect(corpus.entries.get('water-1')).toMatchObject({
      entryId: 'water-1',
      headword: 'water',
      unitId: 'a1-02',
      translations: ['вода', 'водичка'],
      audio: { uk: 'water-1-uk' },
    })
    expect(corpus.units.map((u) => u.unitId)).toEqual(['a1-01', 'a1-02'])
    expect(corpus.units[0]!.wordIds).toEqual([corpusWordId('hello-1'), corpusWordId('bye-1')])
    expect(corpus.units[0]!.title).toEqual({ en: 'a1-01', l1: 'a1-01' })
    expect([...corpus.retired]).toEqual([corpusWordId('bye-1')])
    expect(corpus.themes.map((t) => t.themeId)).toEqual(['greetings', 'food'])
    expect(corpus.clips.get('hello-1-us')).toEqual({ clipId: 'hello-1-us', url: 'audio/hello-1-us.m4a', sha256: 'a'.repeat(64), bytes: 1000, mime: 'audio/mp4' })
  })

  it('merges the packs of a manifest list', () => {
    const extra = pack({
      pack_id: 'extra-bg',
      entries: [entry({ entry_id: 'rice-1', unit_id: 'a2-01', level: 'A2', themes: ['food'] })],
      units: [unit('a2-01', 'A2', 3, ['rice-1'])],
      audio: [],
    })
    const corpus = loadCorpus([pack(), extra])
    expect(corpus.entries.size).toBe(5)
    expect(corpus.units.map((u) => u.unitId)).toEqual(['a1-01', 'a1-02', 'a2-01'])
    expect(corpus.themes).toHaveLength(2)
  })

  it('rejects what only a list can get wrong', () => {
    expect(() => loadCorpus([])).toThrow(/no packs/i)
    expect(() => loadCorpus([pack(), pack({ pack_id: 'again-bg' })])).toThrow(/water-1/)
    const otherL1 = pack({ pack_id: 'corpus-es', l1: 'es', entries: [], units: [], audio: [] })
    expect(() => loadCorpus([pack(), otherL1])).toThrow(/es/)
    const sameOrder = pack({ pack_id: 'x', entries: [entry({ entry_id: 'rice-1', unit_id: 'a1-09' })], units: [unit('a1-09', 'A1', 1, ['rice-1'])], audio: [] })
    expect(() => loadCorpus([pack(), sameOrder])).toThrow(/order 1/)
  })
})

describe('themeEntries', () => {
  it('lists live entries in level order, then path order', () => {
    const extra = pack({
      pack_id: 'extra-bg',
      entries: [entry({ entry_id: 'rice-1', unit_id: 'a2-01', level: 'A2', themes: ['food'] })],
      units: [unit('a2-01', 'A2', 3, ['rice-1'])],
      audio: [],
    })
    const corpus = loadCorpus([pack(), extra])
    expect(themeEntries(corpus, 'food').map((e) => e.entryId)).toEqual(['bread-1', 'water-1', 'rice-1'])
    expect(themeEntries(corpus, 'greetings').map((e) => e.entryId)).toEqual(['hello-1'])
    expect(themeEntries(corpus, 'nope')).toEqual([])
  })
})

describe('offeredThemes', () => {
  function withFoodEntries(count: number, retired: number): Pack {
    const ids = Array.from({ length: count }, (_, i) => `food${i}-1`)
    return pack({
      entries: ids.map((id, i) => entry({ entry_id: id, unit_id: 'a1-01', themes: ['food'], retired: i < retired })),
      units: [unit('a1-01', 'A1', 1, ids)],
      audio: [],
    })
  }

  it('offers a theme once it has the minimum number of live entries', () => {
    expect(offeredThemes(loadCorpus([withFoodEntries(MIN_THEME_SIZE, 0)])).map((t) => t.themeId)).toEqual(['food'])
    expect(offeredThemes(loadCorpus([withFoodEntries(MIN_THEME_SIZE - 1, 0)]))).toEqual([])
  })

  it('does not count retired entries', () => {
    expect(offeredThemes(loadCorpus([withFoodEntries(MIN_THEME_SIZE, 1)]))).toEqual([])
    expect(offeredThemes(loadCorpus([withFoodEntries(MIN_THEME_SIZE + 1, 1)])).map((t) => t.themeId)).toEqual(['food'])
  })
})

describe('entryClips', () => {
  it('returns the clips an entry can play, UK first', () => {
    const corpus = loadCorpus([pack()])
    expect(entryClips(corpus, corpus.entries.get('hello-1')!).map((c) => c.clipId)).toEqual(['hello-1-uk', 'hello-1-us'])
    expect(entryClips(corpus, corpus.entries.get('water-1')!).map((c) => c.clipId)).toEqual(['water-1-uk'])
    expect(entryClips(corpus, corpus.entries.get('bread-1')!)).toEqual([])
  })
})
