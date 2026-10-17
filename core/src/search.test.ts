import { describe, expect, it } from 'vitest'
import { loadCorpus, MIN_THEME_SIZE } from './corpus'
import type { Pack, PackEntry } from './pack'
import { foldText, searchEntries, searchIndex, searchThemes, searchWordIndex, searchWords, wordIndex } from './search'

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

  it('keeps a word that is never taught, under its theme', () => {
    expect(found([...bank, entry({ entry_id: 'banknote-1', themes: ['money'], taught: false })], 'bankn')).toEqual([['money', ['banknote-1']]])
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

describe('searchEntries', () => {
  const entries = [...corpus([...bank, entry({ entry_id: 'river-1', translation: 'река' })]).entries.values()]
  const ids = (query: string) => searchEntries(entries, query)?.map((e) => e.entryId)

  it('keeps the matching words of a list, in the list’s order', () => {
    expect(ids('bank')).toEqual(['bank-1', 'bank-2'])
    expect(ids('Река')).toEqual(['bank-2', 'river-1'])
    expect(ids('bank река')).toEqual(['bank-2'])
    expect(ids('qq')).toEqual([])
  })

  it('keeps every word without a query', () => {
    expect(ids(' r ')).toBeUndefined()
  })
})

describe('searchWordIndex', () => {
  const find = (entries: PackEntry[], query: string) => {
    const ids = searchWordIndex(wordIndex(corpus(entries)), query)
    // The fillers that make the themes big enough are not what these tests are about.
    return ids && ids.filter((id) => !id.includes('x'))
  }

  it('takes a query under two letters as no query', () => {
    expect(find(bank, 'b')).toBeNull()
    expect(find(bank, '  ')).toBeNull()
  })

  it('puts the word itself first, then words that begin with it, then matches in a translation or note', () => {
    const entries = [
      entry({ entry_id: 'flow-1', translation: 'тека', sense: 'run' }),
      entry({ entry_id: 'runway-1' }),
      entry({ entry_id: 'run-1' }),
      entry({ entry_id: 'jog-1', translation: 'run slowly' }),
    ]
    expect(find(entries, 'run')).toEqual(['run-1', 'runway-1', 'flow-1', 'jog-1'])
  })

  it('orders a group by level, then by the word, then by the ID', () => {
    const entries = [
      entry({ entry_id: 'runner-1', level: 'B1' }),
      entry({ entry_id: 'runway-1', level: 'A2' }),
      entry({ entry_id: 'rune-2', headword: 'rune', level: 'A2', sense: 'ancient letter' }),
      entry({ entry_id: 'rune-1', headword: 'rune', level: 'A2', sense: 'mystical symbol' }),
    ]
    expect(find(entries, 'run')).toEqual(['rune-1', 'rune-2', 'runway-1', 'runner-1'])
  })

  it('finds a word by a variant, a translation or the sense note, whatever the accents and the case', () => {
    const entries = [
      entry({ entry_id: 'cafe-1', headword: 'café' }),
      entry({ entry_id: 'colour-1', variants: ['color'] }),
      entry({ entry_id: 'may-1', translation: 'Май' }),
    ]
    expect(find(entries, 'CAFE')).toEqual(['cafe-1'])
    expect(find(entries, 'color')).toEqual(['colour-1'])
    expect(find(entries, 'маи')).toEqual(['may-1'])
  })

  it('wants every word of the query, each at the start of a word', () => {
    const entries = [entry({ entry_id: 'ice-1', headword: 'ice cream' }), entry({ entry_id: 'cream-1' }), entry({ entry_id: 'scream-1' })]
    expect(find(entries, 'ice cr')).toEqual(['ice-1'])
    expect(find(entries, 'cream')).toEqual(['cream-1', 'ice-1'])
  })

  it('ranks a headword of several words as the word itself when the query is that headword', () => {
    const entries = [entry({ entry_id: 'thanks-1', headword: 'thank you' }), entry({ entry_id: 'thank-1' })]
    expect(find(entries, ' Thank  you ')).toEqual(['thanks-1'])
    expect(find(entries, 'thank')).toEqual(['thank-1', 'thanks-1'])
  })

  it('does not find a retired word', () => {
    expect(find([entry({ entry_id: 'old-1', retired: true }), entry({ entry_id: 'older-1' })], 'old')).toEqual(['older-1'])
  })

  it('finds a word that is never taught, as any other', () => {
    expect(find([entry({ entry_id: 'old-1', taught: false }), entry({ entry_id: 'older-1' })], 'old')).toEqual(['old-1', 'older-1'])
  })

  it('takes punctuation in a query as a space, and never throws on it', () => {
    const entries = [entry({ entry_id: 'run-1' })]
    expect(find(entries, 'ru+n')).toEqual([])
    expect(find(entries, '(run)')).toEqual(['run-1'])
    expect(find(entries, '%&?')).toBeNull()
  })
})
