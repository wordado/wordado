import { validateManifest, validatePack } from '@wordado/core'
import { sha256Hex } from './checksum'

/**
 * What would be wrong with serving a directory as the CDN's root (spec §4.4):
 * `manifest.json`, every pack it lists and every clip those packs list, each
 * present with its size and checksum. Empty means it can be published. `read`
 * returns a file's bytes by its path relative to the directory, or null.
 * URLs are already validated as relative by core's validators (validateManifest, validatePack).
 */
export function publishProblems(read: (path: string) => Uint8Array | null): string[] {
  const raw = read('manifest.json')
  if (raw === null) return ['manifest.json: missing']
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return ['manifest.json: not JSON']
  }
  const manifest = validateManifest(json)
  if (manifest.status === 'unsupported_schema') return [`manifest.json: schema ${manifest.schemaVersion} is not supported by this build`]
  if (manifest.status === 'invalid') return manifest.errors.map((e) => `manifest.json ${e.path}: ${e.message}`)

  const problems: string[] = []
  const check = (path: string, expected: { readonly sha256: string; readonly bytes: number }, source: string): Uint8Array | null => {
    const bytes = read(path)
    if (bytes === null) problems.push(`${path}: missing`)
    else if (bytes.length !== expected.bytes) problems.push(`${path}: ${bytes.length} bytes, ${source} says ${expected.bytes}`)
    else if (sha256Hex(bytes) !== expected.sha256) problems.push(`${path}: sha256 does not match ${source}`)
    else return bytes
    return null
  }

  manifest.manifest.packs.forEach((descriptor) => {
    const bytes = check(descriptor.url, descriptor, 'the manifest')
    if (bytes === null) return
    const pack = validatePack(JSON.parse(new TextDecoder().decode(bytes)))
    if (pack.status !== 'ok') {
      problems.push(`${descriptor.url}: ${pack.status === 'invalid' ? pack.errors.map((e) => `${e.path}: ${e.message}`).join('; ') : `schema ${pack.schemaVersion} is not supported`}`)
      return
    }
    pack.pack.audio.forEach((clip) => check(clip.url, clip, 'the pack'))
  })
  return problems
}
