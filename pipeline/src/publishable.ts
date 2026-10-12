import { validateCredits, validateManifest, validatePack, type PackManifest } from '@wordado/core'
import { sha256Hex } from './checksum'
import { TRIAL_MANIFEST } from './trial'

/**
 * What would be wrong with serving a directory as the CDN's root (spec §4.4):
 * `manifest.json`, every pack it lists and every clip those packs list, each
 * present with its size and checksum, and not a draft release (Decision 14).
 * A release directory (one with `release.json`) also needs a valid `credits.json`
 * and a `trial-manifest.json`; where one is present, it and its trial packs are checked the same way.
 * Empty means it can be published. `read` returns a file's bytes by its path
 * relative to the directory, or null. URLs are already validated as relative
 * by core's validators (validateManifest, validatePack).
 */
export function publishProblems(read: (path: string) => Uint8Array | null): string[] {
  const release = read('release.json')
  if (release !== null) {
    try {
      if ((JSON.parse(new TextDecoder().decode(release)) as { draft?: unknown }).draft === true) return ['release.json: a draft build cannot be published']
    } catch {
      return ['release.json: not JSON']
    }
    const credits = read('credits.json')
    if (credits === null) return ['credits.json: missing']
    try {
      if (validateCredits(JSON.parse(new TextDecoder().decode(credits))) === null) return ['credits.json: not a credits file']
    } catch {
      return ['credits.json: not a credits file']
    }
  }
  const problems: string[] = []
  const check = (path: string, expected: { readonly sha256: string; readonly bytes: number }, source: string): Uint8Array | null => {
    const bytes = read(path)
    if (bytes === null) problems.push(`${path}: missing`)
    else if (bytes.length !== expected.bytes) problems.push(`${path}: ${bytes.length} bytes, ${source} says ${expected.bytes}`)
    else if (sha256Hex(bytes) !== expected.sha256) problems.push(`${path}: sha256 does not match ${source}`)
    else return bytes
    return null
  }

  // The course's manifest and the trial's are the same kind of file; `trial` says the packs must carry the field.
  // Returns the manifest, or null with the reason already in `problems`.
  const checkManifest = (file: string, raw: Uint8Array, source: string, trial: boolean): PackManifest | null => {
    let json: unknown
    try {
      json = JSON.parse(new TextDecoder().decode(raw))
    } catch {
      problems.push(`${file}: not JSON`)
      return null
    }
    const manifest = validateManifest(json)
    if (manifest.status === 'unsupported_schema') {
      problems.push(`${file}: schema ${manifest.schemaVersion} is not supported by this build`)
      return null
    }
    if (manifest.status === 'invalid') {
      problems.push(...manifest.errors.map((e) => `${file} ${e.path}: ${e.message}`))
      return null
    }
    manifest.manifest.packs.forEach((descriptor) => {
      const bytes = check(descriptor.url, descriptor, source)
      if (bytes === null) return
      const pack = validatePack(JSON.parse(new TextDecoder().decode(bytes)))
      if (pack.status !== 'ok') {
        problems.push(`${descriptor.url}: ${pack.status === 'invalid' ? pack.errors.map((e) => `${e.path}: ${e.message}`).join('; ') : `schema ${pack.schemaVersion} is not supported`}`)
        return
      }
      if (trial && pack.pack.trial === undefined) {
        problems.push(`${descriptor.url}: not a trial pack`)
        return
      }
      pack.pack.audio.forEach((clip) => check(clip.url, clip, 'the pack'))
    })
    return manifest.manifest
  }

  const raw = read('manifest.json')
  if (raw === null) return ['manifest.json: missing']
  const course = checkManifest('manifest.json', raw, 'the manifest', false)

  // Spec 2026-10-12 §3: a release always carries the trial; an older directory (the sample, last-published/) may not.
  const trialRaw = read(TRIAL_MANIFEST)
  if (trialRaw === null) {
    if (release !== null) problems.push(`${TRIAL_MANIFEST}: missing`)
  } else {
    const trial = checkManifest(TRIAL_MANIFEST, trialRaw, 'the trial manifest', true)
    if (trial !== null && course !== null && trial.corpus_version !== course.corpus_version) {
      problems.push(`${TRIAL_MANIFEST}: corpus version ${trial.corpus_version}, manifest.json has ${course.corpus_version}`)
    }
  }
  return problems
}
