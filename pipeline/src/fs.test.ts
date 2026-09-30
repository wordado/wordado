import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPack } from './build'
import { writeArtifacts } from './fs'

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
const source = (l1: string, corpusVersion: number) => ({
  pack_id: `corpus-${l1}`,
  corpus_version: corpusVersion,
  l1,
  target: 'en',
  entries: [{ ...water, translation: l1 === 'bg' ? 'вода' : 'Wasser' }],
  units: [{ unit_id: 'a1-01', level: 'A1', order: 1, title: { en: 'Food', l1: l1 === 'bg' ? 'Храна' : 'Essen' }, entry_ids: ['water-1'] }],
  themes: [{ theme_id: 'food', name: { en: 'Food', l1: l1 === 'bg' ? 'Храна' : 'Essen' }, description: { en: 'Food.', l1: l1 === 'bg' ? 'Храна.' : 'Essen.' } }],
})
const clips = [{ clipId: 'water-1-uk', bytes: new TextEncoder().encode('not really audio') }]

describe('writeArtifacts', () => {
  const dirs: string[] = []
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-test-'))
    dirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('refuses packs that disagree on corpus_version', () => {
    const outs = [buildPack(source('bg', 3), clips), buildPack(source('de', 4), clips)]
    expect(() => writeArtifacts(tempDir(), outs)).toThrow(/corpus_version/)
  })

  it('refuses packs that disagree on schema_version', () => {
    const bg = buildPack(source('bg', 3), clips)
    const de = buildPack(source('de', 3), clips)
    const mismatched = { ...de, manifest: { ...de.manifest, schema_version: de.manifest.schema_version + 1 } }
    expect(() => writeArtifacts(tempDir(), [bg, mismatched])).toThrow(/schema_version/)
  })
})
