import { describe, expect, it } from 'vitest'
import type { Pack, PackEntry } from './pack'
import { validatePack } from './packValidation'

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

function fixture(over: Partial<Pack> = {}): Pack {
  return {
    schema_version: 1,
    pack_id: 'corpus-bg',
    corpus_version: 0,
    l1: 'bg',
    target: 'en',
    entries: [
      entry({ entry_id: 'hello-1', unit_id: 'a1-01', pos: 'intj', themes: ['greetings'], audio: { uk: 'hello-1-uk' } }),
      entry({ entry_id: 'water-1', unit_id: 'a1-01', themes: ['food'], audio: { uk: 'water-1-uk' } }),
      entry({ entry_id: 'bread-1', unit_id: 'a1-02', themes: ['food'] }),
    ],
    units: [
      { unit_id: 'a1-01', level: 'A1', order: 1, title: { en: 'Hello', l1: 'Здравей' }, entry_ids: ['hello-1', 'water-1'] },
      { unit_id: 'a1-02', level: 'A1', order: 2, title: { en: 'Food', l1: 'Храна' }, entry_ids: ['bread-1'] },
    ],
    themes: [theme('greetings'), theme('food')],
    audio: [clip('hello-1-uk'), clip('water-1-uk')],
    ...over,
  }
}

/** The error paths of an invalid pack, or [] when it is valid. */
function paths(value: unknown): string[] {
  const result = validatePack(value)
  return result.status === 'invalid' ? result.errors.map((e) => e.path) : []
}

function withEntry(index: number, over: Partial<PackEntry>): Pack {
  const base = fixture()
  return { ...base, entries: base.entries.map((e, i) => (i === index ? { ...e, ...over } : e)) }
}

describe('validatePack', () => {
  it('accepts a sound pack and returns it typed', () => {
    const result = validatePack(fixture())
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.pack.entries.map((e) => e.entry_id)).toEqual(['hello-1', 'water-1', 'bread-1'])
  })

  it('reports a schema it cannot read as its own status', () => {
    expect(validatePack(fixture({ schema_version: 2 }))).toEqual({ status: 'unsupported_schema', schemaVersion: 2 })
    expect(validatePack(fixture({ schema_version: 2 }), { supportedSchemaVersions: [1, 2] }).status).toBe('ok')
    expect(paths(fixture({ schema_version: 0 }))).toEqual(['schema_version'])
    expect(paths({ ...fixture(), schema_version: '1' })).toEqual(['schema_version'])
  })

  it('rejects anything that is not an object', () => {
    expect(paths(null)).toEqual([''])
    expect(paths([])).toEqual([''])
    expect(paths('pack')).toEqual([''])
  })

  it('collects every structural error instead of stopping at the first', () => {
    const bad = withEntry(0, { headword: '', level: 'Z9' as never, audio: { fr: 'x' } as never })
    expect(paths(bad)).toEqual(
      expect.arrayContaining(['entries[0].headword', 'entries[0].level', 'entries[0].audio.fr']),
    )
    expect(paths({ ...fixture(), l1: 'bul', target: '', pack_id: 'has space', corpus_version: -1 })).toEqual(
      expect.arrayContaining(['l1', 'target', 'pack_id', 'corpus_version']),
    )
  })

  it('requires an example sentence and IPA on live entries only', () => {
    expect(paths(withEntry(2, { examples: [] }))).toEqual(['entries[2].examples'])
    expect(paths(withEntry(2, { ipa: '' }))).toEqual(['entries[2].ipa'])
    expect(paths(withEntry(2, { examples: [], ipa: '', retired: true }))).toEqual([])
  })

  it('rejects duplicate IDs and duplicate senses, case-insensitively', () => {
    const base = fixture()
    const dupId = { ...base, entries: [...base.entries, entry({ entry_id: 'bread-1', unit_id: 'a1-02' })] }
    expect(paths(dupId)).toContain('entries[3].entry_id')
    expect(paths(withEntry(1, { headword: 'Bread', sense: '' }))).toContain('entries[2]')
    expect(paths(withEntry(1, { headword: 'Bread', sense: 'за пиене' }))).toEqual([])
    expect(paths(withEntry(1, { headword: 'bread', pos: 'verb' }))).toEqual([])
    const dupUnit = { ...base, units: [...base.units, { ...base.units[1]!, order: 3 }] }
    expect(paths(dupUnit)).toContain('units[2].unit_id')
    const dupTheme = { ...base, themes: [...base.themes, theme('food')] }
    expect(paths(dupTheme)).toContain('themes[2].theme_id')
    const dupClip = { ...base, audio: [...base.audio, clip('hello-1-uk')] }
    expect(paths(dupClip)).toContain('audio[2].clip_id')
  })

  it('keeps entries and units consistent in both directions', () => {
    // Both directions report: the entry names an unknown unit, and its old unit still lists it.
    expect(paths(withEntry(2, { unit_id: 'a1-99' }))).toEqual(['entries[2].unit_id', 'units[1].entry_ids[0]'])
    expect(paths(withEntry(2, { unit_id: 'a1-01' }))).toEqual(
      expect.arrayContaining(['entries[2].unit_id', 'units[1].entry_ids[0]']),
    )
    expect(paths(withEntry(2, { level: 'A2' }))).toEqual(['entries[2].level'])
    const base = fixture()
    const listsUnknown = { ...base, units: [base.units[0]!, { ...base.units[1]!, entry_ids: ['bread-1', 'nope-1'] }] }
    expect(paths(listsUnknown)).toEqual(['units[1].entry_ids[1]'])
    const empty = { ...base, units: [...base.units, { ...base.units[1]!, unit_id: 'a1-03', order: 3, entry_ids: [] }] }
    expect(paths(empty)).toEqual(['units[2].entry_ids'])
    const twice = { ...base, units: [base.units[0]!, { ...base.units[1]!, entry_ids: ['bread-1', 'bread-1'] }] }
    expect(paths(twice)).toEqual(['units[1].entry_ids[1]'])
  })

  it('keeps path order unique and never going back a level', () => {
    const base = fixture()
    const sameOrder = { ...base, units: [base.units[0]!, { ...base.units[1]!, order: 1 }] }
    expect(paths(sameOrder)).toEqual(['units[1].order'])
    const a2First: Pack = {
      ...base,
      entries: base.entries.map((e) => (e.unit_id === 'a1-01' ? { ...e, level: 'A2' } : e)),
      units: [{ ...base.units[0]!, level: 'A2' }, base.units[1]!],
    }
    expect(paths(a2First)).toEqual(['units[1].order'])
  })

  it('resolves themes and clips, and tolerates no orphan clip', () => {
    expect(paths(withEntry(0, { themes: ['greetings', 'nope'] }))).toEqual(['entries[0].themes[1]'])
    expect(paths(withEntry(0, { audio: { uk: 'nope-uk' } }))).toEqual(
      expect.arrayContaining(['entries[0].audio.uk', 'audio[0].clip_id']),
    )
    const base = fixture()
    const orphan = { ...base, audio: [...base.audio, clip('bread-1-uk')] }
    expect(paths(orphan)).toEqual(['audio[2].clip_id'])
  })

  it('checks clip URLs and checksums', () => {
    const base = fixture()
    const withUrl = (url: string) => ({ ...base, audio: [{ ...base.audio[0]!, url }, base.audio[1]!] })
    for (const url of ['/audio/x.m4a', 'audio/../x.m4a', 'https://cdn.example/x.m4a', '']) {
      expect(paths(withUrl(url)), url).toContain('audio[0].url')
    }
    expect(paths(withUrl('audio/x.m4a'))).toEqual([])
    const badHash = { ...base, audio: [{ ...base.audio[0]!, sha256: 'A'.repeat(64) }, base.audio[1]!] }
    expect(paths(badHash)).toEqual(['audio[0].sha256'])
    const badBytes = { ...base, audio: [{ ...base.audio[0]!, bytes: 0 }, base.audio[1]!] }
    expect(paths(badBytes)).toEqual(['audio[0].bytes'])
  })

  it('requires both languages of every localized text', () => {
    const base = fixture()
    const half = { ...base, themes: [base.themes[0]!, { ...base.themes[1]!, description: { en: 'Food', l1: '' } }] }
    expect(paths(half)).toEqual(['themes[1].description.l1'])
    const noTitle = { ...base, units: [{ ...base.units[0]!, title: 'Hello' as never }, base.units[1]!] }
    expect(paths(noTitle)).toEqual(['units[0].title'])
  })

  it('accepts an empty pack: the checks are on what is there', () => {
    expect(paths(fixture({ entries: [], units: [], themes: [], audio: [] }))).toEqual([])
  })
})
