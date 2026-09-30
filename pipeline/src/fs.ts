import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { MANIFEST_SCHEMA_VERSION, type PackManifest } from '@wordado/core'
import { AUDIO_EXT, type BuildOutput, type ClipFile } from './build'

export interface SourceDir {
  /** Every `source*.json` beside the audio, in name order: one per L1's pack. */
  readonly sources: readonly unknown[]
  readonly clips: ClipFile[]
}

/** A source directory: one `source*.json` per L1 beside a shared `audio/` directory of `.m4a` clips named by clip ID. */
export function readSourceDir(dir: string): SourceDir {
  const sources = readdirSync(dir)
    .filter((name) => /^source.*\.json$/.test(name))
    .sort()
    .map((name): unknown => JSON.parse(readFileSync(join(dir, name), 'utf8')))
  const audioDir = join(dir, 'audio')
  const clips = readdirSync(audioDir)
    .filter((name) => extname(name) === `.${AUDIO_EXT}`)
    .sort()
    .map((name) => ({ clipId: basename(name, `.${AUDIO_EXT}`), bytes: new Uint8Array(readFileSync(join(audioDir, name))) }))
  return { sources, clips }
}

/** Writes every pack and one manifest listing them all, sorted by L1, beside the sources, where the audio already is. */
export function writeArtifacts(dir: string, outs: readonly BuildOutput[]): void {
  for (const out of outs) writeFileSync(join(dir, out.packFile), out.packBytes)
  const manifest: PackManifest = {
    schema_version: outs[0]?.manifest.schema_version ?? MANIFEST_SCHEMA_VERSION,
    corpus_version: outs[0]?.manifest.corpus_version ?? 0,
    packs: outs.flatMap((o) => o.manifest.packs).sort((a, b) => (a.l1 < b.l1 ? -1 : 1)),
  }
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}
