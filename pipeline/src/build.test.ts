import { validatePack } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { BuildError, buildPack } from './build'
import { sha256Hex } from './checksum'

const water = {
  entry_id: 'water-1',
  headword: 'water',
  variants: [],
  pos: 'noun',
  sense: '',
  ipa: 'ˈwɔːtə',
  level: 'A1',
  unit_id: 'a1-01',
  themes: ['food'],
  translation: 'вода',
  alternates: [],
  examples: ['Water, please.'],
  audio: { uk: 'water-1-uk' },
  retired: false,
}
const bread = { ...water, entry_id: 'bread-1', headword: 'bread', ipa: 'bred', translation: 'хляб', audio: {} }

const source = (entries = [water, bread]) => ({
  pack_id: 'corpus-bg',
  corpus_version: 3,
  l1: 'bg',
  target: 'en',
  entries,
  units: [{ unit_id: 'a1-01', level: 'A1', order: 1, title: { en: 'Food', l1: 'Храна' }, entry_ids: ['water-1', 'bread-1'] }],
  themes: [{ theme_id: 'food', name: { en: 'Food', l1: 'Храна' }, description: { en: 'Food.', l1: 'Храна.' } }],
})
const clips = [{ clipId: 'water-1-uk', bytes: new TextEncoder().encode('not really audio') }]

describe('buildPack', () => {
  it('derives the audio manifest from the clip files', () => {
    const out = buildPack(source(), clips)
    expect(out.pack.audio).toEqual([
      { clip_id: 'water-1-uk', url: 'audio/water-1-uk.m4a', sha256: sha256Hex(clips[0]!.bytes), bytes: 16, mime: 'audio/mp4' },
    ])
    expect(out.pack.schema_version).toBe(1)
  })

  it('names the file and describes it in a one-pack manifest', () => {
    const out = buildPack(source(), clips)
    expect(out.packFile).toBe('corpus-v3-bg.pack')
    expect(out.manifest).toEqual({
      schema_version: 1,
      corpus_version: 3,
      packs: [
        { pack_id: 'corpus-bg', l1: 'bg', corpus_version: 3, schema_version: 1, url: 'corpus-v3-bg.pack', sha256: sha256Hex(out.packBytes), bytes: out.packBytes.byteLength },
      ],
    })
  })

  it('gives the same bytes whatever the order of the source and the clips', () => {
    const a = buildPack(source([water, bread]), clips)
    const b = buildPack(source([bread, water]), [...clips].reverse())
    expect(Buffer.from(a.packBytes).equals(Buffer.from(b.packBytes))).toBe(true)
    expect(a.pack.entries.map((e) => e.entry_id)).toEqual(['bread-1', 'water-1'])
  })

  it('produces bytes that parse and validate as a pack', () => {
    const out = buildPack(source(), clips)
    const text = new TextDecoder().decode(out.packBytes)
    // Canonical: keys sorted, so the document opens with the audio manifest, and no whitespace between tokens.
    expect(text.startsWith('{"audio":[{"bytes":16,"clip_id":"water-1-uk"')).toBe(true)
    expect(validatePack(JSON.parse(text)).status).toBe('ok')
  })

  it('reports every validation error', () => {
    const bad = source([{ ...water, unit_id: 'a1-99', themes: ['nope'] }, bread])
    expect(() => buildPack(bad, clips)).toThrow(BuildError)
    try {
      buildPack(bad, clips)
    } catch (err) {
      expect((err as BuildError).errors.map((e) => e.path)).toEqual(
        expect.arrayContaining(['entries[0].unit_id', 'entries[0].themes[0]']),
      )
    }
  })

  it('refuses a source that carries what the build derives', () => {
    expect(() => buildPack({ ...source(), audio: [] }, clips)).toThrow(/derived/)
    expect(() => buildPack({ ...source(), schema_version: 1 }, clips)).toThrow(/derived/)
    expect(() => buildPack('nope', clips)).toThrow(BuildError)
  })
})
