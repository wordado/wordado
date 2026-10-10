import { describe, expect, it } from 'vitest'
import { loadCorpus, MIN_THEME_SIZE } from './corpus'
import type { Pack, PackEntry } from './pack'
import { foldText, searchIndex, searchThemes, searchWords } from './search'

function entry(over: Partial<PackEntry> & Pick<PackEntry, 'entry_id'>): PackEntry {
  return {
    unit_id: 'a1-01',
    headword: over.entry_id.replace(/-\d+$/, ''),
    variants: [],
    pos: 'noun',
    sense: '',
    ipa: 'x',
    level: 'A1',
    themes: [],
    translation: `t${over.entry_id}`,
    alternates: [],
    examples: ['An example.'],
    audio: {},
    retired: false,
    ...over,
  }
}

const theme = (id: string, en: string, l1: string, about = '') => ({ theme_id: id, name: { en, l1 }, description: { en: about, l1: about } })

/** Enough plain words to make a theme big enough to offer. */
const filler = (themeId: string, count = MIN_THEME_SIZE): PackEntry[] =>
  Array.from({ length: count }, (_, i) => entry({ entry_id: `${themeId}x${i}-1`, headword: `zz${themeId}${i}`, themes: [themeId] }))

function corpus(entries: PackEntry[], themes = [theme('money', 'Money', 'Пари'), theme('nature', 'Nature', 'Природа'), theme('out', 'Eating out', 'На ресторант', 'In a café or a restaurant.')]) {
  const all = [...themes.flatMap((t) => filler(t.theme_id)), ...entries]
  const pack: Pack = {
    schema_version: 1,
    pack_id: 'corpus-bg',
    corpus_version: 1,
    l1: 'bg',
    target: 'en',
    entries: all,
    units: [{ unit_id: 'a1-01', level: 'A1', order: 1, title: { en: 'u', l1: 'u' }, entry_ids: all.map((e) => e.entry_id) }],
    themes,
    audio: [],
  }
  return loadCorpus([pack])
}

const search = (entries: PackEntry[], query: string, themes?: Parameters<typeof corpus>[1]) => searchThemes(searchIndex(corpus(entries, themes)), query)
const found = (entries: PackEntry[], query: string) => search(entries, query)!.themes.map((m) => [m.theme.themeId, m.entries.map((e) => e.entryId)])

const bank = [
  entry({ entry_id: 'bank-1', themes: ['money'], translation: 'банка', sense: 'финансова институция' }),
  entry({ entry_id: 'bank-2', themes: ['nature'], translation: 'бряг', sense: 'на река' }),
]

describe('foldText', () => {
  it('lowers the case and drops accents', () => {
    expect(foldText('Café Ñandú ÜBER')).toBe('cafe nandu uber')
    expect(foldText('Май')).toBe('маи')
  })
})

describe('searchWords', () => {
  it('takes a query of fewer than two letters, or of spaces, as no query', () => {
    expect(searchWords('')).toBeNull()
    expect(searchWords('  b ')).toBeNull()
    expect(searchWords(' -- ')).toBeNull()
    expect(searchWords('a b')).toEqual(['a', 'b'])
    expect(searchWords(' Bank ')).toEqual(['bank'])
  })
})

describe('searchThemes', () => {
  it('finds nothing to filter by without a query', () => {
    expect(search(bank, 'b')).toBeNull()
  })

  it('keeps the themes that hold the word, each with the sense it holds', () => {
    expect(found(bank, 'bank')).toEqual([
      ['money', ['bank-1']],
      ['nature', ['bank-2']],
    ])
  })

  it('matches from the beginning of a word only', () => {
    const entries = [...bank, entry({ entry_id: 'banking-1', themes: ['money'] }), entry({ entry_id: 'embankment-1', themes: ['nature'] })]
    expect(found(entries, 'Bank')).toEqual([
      ['money', ['bank-1', 'banking-1']],
      ['nature', ['bank-2']],
    ])
  })

  it('finds a word by a translation, an alternate, a variant or its sense note, whatever the case and accents', () => {
    const entries = [...bank, entry({ entry_id: 'colour-1', variants: ['color'], themes: ['nature'], translation: 'цвят', alternates: ['багра'] })]
    expect(found(entries, 'БРЯГ')).toEqual([['nature', ['bank-2']]])
    expect(found(entries, 'институция')).toEqual([['money', ['bank-1']]])
    expect(found(entries, 'color')).toEqual([['nature', ['colour-1']]])
    expect(found(entries, 'багра')).toEqual([['nature', ['colour-1']]])
    expect(found([entry({ entry_id: 'cafe-1', headword: 'café', themes: ['out'] })], 'cafe')[0]).toEqual(['out', ['cafe-1']])
  })

  it('asks every word of the query of the same entry', () => {
    expect(found(bank, 'bank река')).toEqual([['nature', ['bank-2']]])
    expect(found(bank, 'bank zz')).toEqual([])
  })

  it('finds a theme by its name in either language, or by its description, with no word matching', () => {
    expect(found([], 'eating')).toEqual([['out', []]])
    expect(found([], 'ресторант')).toEqual([['out', []]])
    expect(search([], 'restaurant')!.themes.map((m) => [m.theme.themeId, m.nameMatch])).toEqual([['out', true]])
  })

  it('puts a theme found by name first, then the themes with the most matching words, then the pack’s order', () => {
    const entries = [
      entry({ entry_id: 'eat-1', themes: ['nature'] }),
      entry({ entry_id: 'eatery-1', themes: ['nature'] }),
      entry({ entry_id: 'eater-1', themes: ['money'] }),
    ]
    expect(found(entries, 'eat').map(([id]) => id)).toEqual(['out', 'nature', 'money'])
    expect(found([entry({ entry_id: 'eat-1', themes: ['nature', 'money'] })], 'eat').map(([id]) => id)).toEqual(['out', 'money', 'nature'])
  })

  it('shows a word of two themes under both', () => {
    expect(found([entry({ entry_id: 'tip-1', themes: ['money', 'out'] })], 'tip')).toEqual([
      ['money', ['tip-1']],
      ['out', ['tip-1']],
    ])
  })

  it('leaves retired words out', () => {
    expect(found([...bank, entry({ entry_id: 'banknote-1', themes: ['money'], retired: true })], 'bankn')).toEqual([])
  })

  it('lists apart the matching words of no theme, and of a theme too small to offer', () => {
    const themes = [theme('money', 'Money', 'Пари'), theme('small', 'Small', 'Малка')]
    const entries = [bank[0]!, entry({ entry_id: 'bank-2', sense: 'b' }), entry({ entry_id: 'bank-3', sense: 'c', themes: ['small'], level: 'B1' }), entry({ entry_id: 'banker-1', themes: ['small'] })]
    const pack = corpus(entries, [themes[0]!])
    // The small theme: defined, but with two words only.
    const result = searchThemes(searchIndex({ ...pack, themes: [...pack.themes, { themeId: 'small', name: themes[1]!.name, description: themes[1]!.description }] }), 'bank')!
    expect(result.themes.map((m) => m.theme.themeId)).toEqual(['money'])
    // Level first, then the path.
    expect(result.unthemed.map((e) => e.entryId)).toEqual(['bank-2', 'banker-1', 'bank-3'])
    expect(searchThemes(searchIndex(pack), 'small')!.themes).toEqual([])
  })
})
