import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { AUDIO_EXT, type BuildOutput, type ClipFile } from './build'

export interface SourceDir {
  readonly source: unknown
  readonly clips: ClipFile[]
}

/** A source directory: `source.json` beside an `audio/` directory of `.m4a` clips named by clip ID. */
export function readSourceDir(dir: string): SourceDir {
  const source: unknown = JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8'))
  const audioDir = join(dir, 'audio')
  const clips = readdirSync(audioDir)
    .filter((name) => extname(name) === `.${AUDIO_EXT}`)
    .sort()
    .map((name) => ({ clipId: basename(name, `.${AUDIO_EXT}`), bytes: new Uint8Array(readFileSync(join(audioDir, name))) }))
  return { source, clips }
}

/** Writes the pack and its one-pack manifest beside the source, where the audio already is. */
export function writeArtifacts(dir: string, out: BuildOutput): void {
  writeFileSync(join(dir, out.packFile), out.packBytes)
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(out.manifest, null, 2)}\n`)
}
