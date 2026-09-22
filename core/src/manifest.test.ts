import { describe, expect, it } from 'vitest'
import { selectPacks, validateManifest, type PackDescriptor, type PackManifest } from './manifest'

const bg = (corpus_version: number, schema_version = 1): PackDescriptor => ({
  pack_id: 'corpus-bg',
  l1: 'bg',
  corpus_version,
  schema_version,
  url: `corpus-v${corpus_version}-bg.pack`,
  sha256: 'b'.repeat(64),
  bytes: 120_000,
})
const es = (corpus_version: number): PackDescriptor => ({ ...bg(corpus_version), pack_id: 'corpus-es', l1: 'es', url: `corpus-v${corpus_version}-es.pack` })
const manifest = (packs: PackDescriptor[], corpus_version = 1): PackManifest => ({ schema_version: 1, corpus_version, packs })
const supported = [1]

describe('validateManifest', () => {
  it('accepts a sound manifest', () => {
    expect(validateManifest(manifest([bg(1), es(1)]))).toEqual({ status: 'ok', manifest: manifest([bg(1), es(1)]) })
  })

  it('reports an unreadable schema as its own status', () => {
    expect(validateManifest({ ...manifest([]), schema_version: 3 })).toEqual({ status: 'unsupported_schema', schemaVersion: 3 })
  })

  it('collects field errors and duplicate pack ids', () => {
    const result = validateManifest(manifest([{ ...bg(1), url: '/abs', sha256: 'zz', bytes: 0 }, bg(2)]))
    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') {
      expect(result.errors.map((e) => e.path)).toEqual(
        expect.arrayContaining(['packs[0].url', 'packs[0].sha256', 'packs[0].bytes', 'packs[1].pack_id']),
      )
    }
    expect(validateManifest(null).status).toBe('invalid')
    expect(validateManifest({ schema_version: 1, corpus_version: 1 }).status).toBe('invalid')
  })
})

describe('selectPacks', () => {
  it('fetches the learner-L1 packs a fresh install lacks and ignores other L1s', () => {
    const out = selectPacks({ manifest: manifest([bg(1), es(1)]), l1: 'bg', installed: [], supportedSchemaVersions: supported })
    expect(out).toEqual({ fetch: [bg(1)], appUpdateNeeded: [] })
  })

  it('fetches only a newer version', () => {
    const installed = [{ pack_id: 'corpus-bg', corpus_version: 1, schema_version: 1 }]
    expect(selectPacks({ manifest: manifest([bg(1)]), l1: 'bg', installed, supportedSchemaVersions: supported }).fetch).toEqual([])
    expect(selectPacks({ manifest: manifest([bg(2)], 2), l1: 'bg', installed, supportedSchemaVersions: supported }).fetch).toEqual([bg(2)])
    expect(selectPacks({ manifest: manifest([bg(0)]), l1: 'bg', installed, supportedSchemaVersions: supported }).fetch).toEqual([])
  })

  it('keeps the current pack and asks for an app update when the schema is newer than it reads', () => {
    const installed = [{ pack_id: 'corpus-bg', corpus_version: 1, schema_version: 1 }]
    const out = selectPacks({ manifest: manifest([bg(2, 2)], 2), l1: 'bg', installed, supportedSchemaVersions: supported })
    expect(out).toEqual({ fetch: [], appUpdateNeeded: [bg(2, 2)] })
    expect(selectPacks({ manifest: manifest([bg(2, 2)], 2), l1: 'bg', installed, supportedSchemaVersions: [1, 2] }).fetch).toEqual([bg(2, 2)])
  })

  it('handles several packs for one L1 independently', () => {
    const extra: PackDescriptor = { ...bg(1), pack_id: 'exam-bg', url: 'exam-v1-bg.pack' }
    const installed = [{ pack_id: 'corpus-bg', corpus_version: 1, schema_version: 1 }]
    const out = selectPacks({ manifest: manifest([bg(1), extra]), l1: 'bg', installed, supportedSchemaVersions: supported })
    expect(out.fetch).toEqual([extra])
  })

  it('leaves an installed pack alone when the manifest no longer lists it', () => {
    const installed = [{ pack_id: 'gone-bg', corpus_version: 1, schema_version: 1 }]
    expect(selectPacks({ manifest: manifest([]), l1: 'bg', installed, supportedSchemaVersions: supported })).toEqual({ fetch: [], appUpdateNeeded: [] })
  })
})
