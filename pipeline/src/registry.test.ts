import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validatePack, type Pack } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { assignIds, registryFromSample, slugOf, type Registry } from './registry'

const samplePack = (() => {
  const file = fileURLToPath(new URL('../samples/a1-bg/corpus-v0-bg.pack', import.meta.url))
  const r = validatePack(JSON.parse(readFileSync(file, 'utf8')))
  if (r.status !== 'ok') throw new Error('sample invalid')
  return r.pack as Pack
})()

describe('slugOf (Decision 10)', () => {
  it('makes IDs like the sample’s', () => {
    expect(['thank you', "o'clock", 'Café', 'well-known', '  ', "’"].map(slugOf)).toEqual(['thank_you', 'oclock', 'cafe', 'well-known', 'w', 'w'])
  })
})

describe('registryFromSample', () => {
  it('pins every sample entry under its own ID and keeps its units', () => {
    const r = registryFromSample(samplePack)
    expect(r.entries).toHaveLength(60)
    expect(r.entries.every((e) => e.pinned && e.sense_en === '')).toBe(true)
    expect(r.entries.find((e) => e.entry_id === 'thank_you-1')).toMatchObject({ headword: 'thank you' })
    expect(r.units.map((u) => u.unit_id)).toEqual(['a1-01', 'a1-02', 'a1-03'])
  })
})

describe('assignIds', () => {
  const base: Registry = {
    entries: [
      { entry_id: 'bank-1', headword: 'bank', pos: 'noun', sense_en: 'money', pinned: false },
      { entry_id: 'hello-1', headword: 'hello', pos: 'intj', sense_en: '', pinned: true },
      { entry_id: 'run-3', headword: 'run', pos: 'verb', sense_en: 'move fast', pinned: false },
    ],
    units: [],
  }

  it('keeps an exact match’s ID', () => {
    expect(assignIds(base, [{ headword: 'bank', pos: 'noun', sense_en: 'Money ' }]).ids).toEqual(['bank-1'])
  })

  it('matches a lone sense to a lone registry entry whose gloss moved, and records the new gloss', () => {
    const out = assignIds(base, [{ headword: 'hello', pos: 'intj', sense_en: 'greeting' }])
    expect(out.ids).toEqual(['hello-1'])
    expect(out.registry.entries.find((e) => e.entry_id === 'hello-1')).toMatchObject({ sense_en: 'greeting', pinned: true })
  })

  it('binds an unlabelled entry to the first of several senses of its headword and POS, and records that gloss', () => {
    const registry: Registry = { entries: [{ entry_id: 'time-1', headword: 'time', pos: 'noun', sense_en: '', pinned: true }], units: [] }
    const out = assignIds(registry, [
      { headword: 'time', pos: 'noun', sense_en: 'duration' },
      { headword: 'time', pos: 'noun', sense_en: 'occasion' },
    ])
    expect(out.ids).toEqual(['time-1', 'time-2'])
    expect(out.registry.entries.find((e) => e.entry_id === 'time-1')).toMatchObject({ sense_en: 'duration', pinned: true })
  })

  it('gives a new sense the next number for its slug, never reusing one', () => {
    const out = assignIds(base, [
      { headword: 'bank', pos: 'noun', sense_en: 'money' },
      { headword: 'bank', pos: 'noun', sense_en: 'river' },
      { headword: 'run', pos: 'noun', sense_en: '' },
    ])
    expect(out.ids).toEqual(['bank-1', 'bank-2', 'run-4'])
    expect(out.registry.entries).toHaveLength(5)
  })

  it('never deletes an entry the new senses no longer mention', () => {
    expect(assignIds(base, []).registry.entries).toEqual(base.entries)
  })

  it('refuses the same sense twice in one call', () => {
    expect(() => assignIds(base, [{ headword: 'x', pos: 'noun', sense_en: '' }, { headword: 'X', pos: 'noun', sense_en: '' }])).toThrow(/twice/)
  })
})
