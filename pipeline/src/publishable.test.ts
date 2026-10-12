import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { sha256Hex } from './checksum'
import { runDraft } from './draft'
import { publishProblems } from './publishable'
import { planRelease, writeRelease } from './release'
import { approveAll, makeContent, recordAudio, sampleLlm } from './testing/fixture'
import { TRIAL_MANIFEST } from './trial'

const DIR = fileURLToPath(new URL('../samples/a1/', import.meta.url))

/** Reads the sample, with some files replaced (bytes) or removed (null). */
function sample(over: Record<string, Uint8Array | null> = {}) {
  return (path: string): Uint8Array | null => {
    if (path in over) return over[path]!
    const full = join(DIR, path)
    return existsSync(full) ? new Uint8Array(readFileSync(full)) : null
  }
}

const manifest = () => JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'))
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

/** A release.json on the sample, with the trial manifest a release must have (here listing no packs). */
const asRelease = (release: unknown) => ({ 'release.json': bytes(release), [TRIAL_MANIFEST]: bytes({ ...manifest(), packs: [] }) })

describe('publishProblems (spec §4.4: never a manifest whose files are not all in place)', () => {
  it('finds nothing wrong with the sample', () => {
    expect(publishProblems(sample())).toEqual([])
  })

  it('names a missing manifest', () => {
    expect(publishProblems(sample({ 'manifest.json': null }))).toEqual(['manifest.json: missing'])
  })

  it("names a pack whose bytes differ from the manifest's checksum", () => {
    const pack = readFileSync(join(DIR, 'corpus-v0-bg.pack'))
    const tampered = new Uint8Array(pack)
    tampered[10] = tampered[10]! ^ 1
    expect(publishProblems(sample({ 'corpus-v0-bg.pack': tampered }))).toEqual(['corpus-v0-bg.pack: sha256 does not match the manifest'])
  })

  it('names a missing or truncated clip, once per pack that lists it (the sample’s three packs share audio/)', () => {
    const clip = new Uint8Array(readFileSync(join(DIR, 'audio/hello-1-uk.m4a')))
    expect(publishProblems(sample({ 'audio/hello-1-uk.m4a': null }))).toEqual(Array(3).fill('audio/hello-1-uk.m4a: missing'))
    expect(publishProblems(sample({ 'audio/hello-1-uk.m4a': clip.slice(0, 100) }))).toEqual(Array(3).fill(`audio/hello-1-uk.m4a: ${100} bytes, the pack says ${clip.length}`))
  })

  it('refuses a URL that is not relative to the manifest', () => {
    const m = manifest()
    m.packs[0].url = 'https://elsewhere.example/corpus-v0-bg.pack'
    expect(publishProblems(sample({ 'manifest.json': bytes(m) }))).toEqual([
      'manifest.json packs[0].url: must be a relative path without ".."',
    ])
    m.packs[0].url = '../corpus-v0-bg.pack'
    expect(publishProblems(sample({ 'manifest.json': bytes(m) }))).toEqual([
      'manifest.json packs[0].url: must be a relative path without ".."',
    ])
  })

  it("names an invalid manifest by its validator's errors", () => {
    expect(publishProblems(sample({ 'manifest.json': bytes({ schema_version: 1 }) })).length).toBeGreaterThan(0)
  })

  it('refuses a draft release, and a release.json that is not JSON', () => {
    expect(publishProblems(sample({ 'release.json': bytes({ draft: true }) }))).toEqual(['release.json: a draft build cannot be published'])
    expect(publishProblems(sample({ 'release.json': new TextEncoder().encode('{') }))).toEqual(['release.json: not JSON'])
    expect(publishProblems(sample(asRelease({ draft: false })))).toEqual([])
  })

  it('needs a valid credits.json once release.json is present', () => {
    const valid = sample(asRelease({ draft: false }))
    expect(publishProblems(valid)).toEqual([])
    expect(publishProblems((path) => (path === 'credits.json' ? null : valid(path)))).toEqual(['credits.json: missing'])
    expect(publishProblems((path) => (path === 'credits.json' ? bytes({ schema_version: 2 }) : valid(path)))).toEqual(['credits.json: not a credits file'])
  })
})

describe('publishProblems on the trial files (spec 2026-10-12 §3)', () => {
  let dir: string
  beforeAll(async () => {
    const content = makeContent()
    await runDraft({ dir: content, llm: sampleLlm(), offline: false })
    await recordAudio(content)
    approveAll(content)
    dir = join(mkdtempSync(join(tmpdir(), 'publishable-')), 'out')
    writeRelease(content, dir, planRelease(content, { draft: false, now: '2026-10-02T09:00:00Z' }))
  }, 60_000)

  const release = (over: Record<string, Uint8Array | null> = {}) => (path: string): Uint8Array | null => {
    if (path in over) return over[path]!
    const full = join(dir, path)
    return existsSync(full) ? new Uint8Array(readFileSync(full)) : null
  }
  const json = (path: string) => JSON.parse(readFileSync(join(dir, path), 'utf8'))
  const trialFile = () => json(TRIAL_MANIFEST).packs[0].url as string

  it('finds nothing wrong with a real release', () => {
    expect(publishProblems(release())).toEqual([])
  })

  it('needs trial-manifest.json in a release directory, but not elsewhere; the sample still has no problems', () => {
    expect(publishProblems(release({ [TRIAL_MANIFEST]: null }))).toEqual(['trial-manifest.json: missing'])
    const noRelease = release({ 'release.json': null, 'credits.json': null, [TRIAL_MANIFEST]: null })
    expect(publishProblems(noRelease)).toEqual([])
    expect(publishProblems(sample())).toEqual([])
  })

  it('checks a trial manifest that is present even without release.json', () => {
    const noRelease = release({ 'release.json': null, 'credits.json': null, [trialFile()]: null })
    expect(publishProblems(noRelease)).toEqual([`${trialFile()}: missing`])
  })

  it('reports a trial manifest that is not JSON, unsupported or invalid, as it does manifest.json', () => {
    expect(publishProblems(release({ [TRIAL_MANIFEST]: new TextEncoder().encode('{') }))).toEqual(['trial-manifest.json: not JSON'])
    const unsupported = { ...json(TRIAL_MANIFEST), schema_version: 99 }
    expect(publishProblems(release({ [TRIAL_MANIFEST]: bytes(unsupported) }))).toEqual(['trial-manifest.json: schema 99 is not supported by this build'])
    const invalid = publishProblems(release({ [TRIAL_MANIFEST]: bytes({ schema_version: 1 }) }))
    expect(invalid.length).toBeGreaterThan(0)
    expect(invalid.every((p) => p.startsWith('trial-manifest.json '))).toBe(true)
  })

  it('names a trial pack that is missing, or whose bytes differ from the trial manifest', () => {
    const file = trialFile()
    expect(publishProblems(release({ [file]: null }))).toEqual([`${file}: missing`])
    const tampered = new Uint8Array(readFileSync(join(dir, file)))
    tampered[10] = tampered[10]! ^ 1
    expect(publishProblems(release({ [file]: tampered }))).toEqual([`${file}: sha256 does not match the trial manifest`])
    expect(publishProblems(release({ [file]: tampered.slice(0, 100) }))).toEqual([
      `${file}: 100 bytes, the trial manifest says ${json(TRIAL_MANIFEST).packs[0].bytes}`,
    ])
  })

  it('names a trial pack that has no trial field', () => {
    const file = trialFile()
    const { trial: _trial, ...course } = json(file)
    const stripped = bytes(course)
    const m = json(TRIAL_MANIFEST)
    m.packs[0] = { ...m.packs[0], bytes: stripped.length, sha256: sha256Hex(stripped) }
    expect(publishProblems(release({ [file]: stripped, [TRIAL_MANIFEST]: bytes(m) }))).toEqual([`${file}: not a trial pack`])
  })

  it('names a trial pack that is not a valid pack', () => {
    const file = trialFile()
    const broken = bytes({ ...json(file), entries: 'none' })
    const m = json(TRIAL_MANIFEST)
    m.packs[0] = { ...m.packs[0], bytes: broken.length, sha256: sha256Hex(broken) }
    const problems = publishProblems(release({ [file]: broken, [TRIAL_MANIFEST]: bytes(m) }))
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.every((p) => p.startsWith(`${file}: `))).toBe(true)
  })

  it('names a clip the trial pack lists that is missing or altered, after the course’s own problems of it', () => {
    const clip = json(trialFile()).audio[0].url as string
    expect(publishProblems(release({ [clip]: null }))).toEqual(Array(2).fill(`${clip}: missing`))
    const altered = new Uint8Array(readFileSync(join(dir, clip)))
    altered[0] = altered[0]! ^ 1
    expect(publishProblems(release({ [clip]: altered }))).toEqual(Array(2).fill(`${clip}: sha256 does not match the pack`))
  })

  it("names a trial manifest whose corpus version is not the course manifest's", () => {
    const m = { ...json(TRIAL_MANIFEST), corpus_version: json('manifest.json').corpus_version + 1 }
    expect(publishProblems(release({ [TRIAL_MANIFEST]: bytes(m) }))).toEqual([
      `trial-manifest.json: corpus version ${m.corpus_version}, manifest.json has ${m.corpus_version - 1}`,
    ])
  })

  it('keeps the course problems first, then the trial ones', () => {
    const course = json('manifest.json').packs[0].url as string
    const flipped = new Uint8Array(readFileSync(join(dir, course)))
    flipped[10] = flipped[10]! ^ 1
    expect(publishProblems(release({ [course]: flipped, [TRIAL_MANIFEST]: null }))).toEqual([
      `${course}: sha256 does not match the manifest`,
      'trial-manifest.json: missing',
    ])
  })
})
