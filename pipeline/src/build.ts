import {
  canonicalJson,
  MANIFEST_SCHEMA_VERSION,
  PACK_SCHEMA_VERSION,
  validatePack,
  type Pack,
  type PackAudioClip,
  type PackError,
  type PackManifest,
} from '@wordado/core'
import { sha256Hex } from './checksum'

/** AAC in an MP4 container: playable in every launch browser (spec §9.3). */
export const AUDIO_MIME = 'audio/mp4'
export const AUDIO_EXT = 'm4a'

export interface ClipFile {
  readonly clipId: string
  readonly bytes: Uint8Array
}

export interface BuildOutput {
  readonly pack: Pack
  /** `corpus-v<version>-<l1>.pack`: the file name the manifest points at. */
  readonly packFile: string
  readonly packBytes: Uint8Array
  /** A manifest listing this pack alone; plan 8 composes the multi-L1 manifest. */
  readonly manifest: PackManifest
}

export class BuildError extends Error {
  readonly errors: readonly PackError[]
  constructor(errors: readonly PackError[]) {
    super(errors.map((e) => `${e.path || '(pack)'}: ${e.message}`).join('\n'))
    this.name = 'BuildError'
    this.errors = errors
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Assembles a pack from a source (the pack without `schema_version` and
 * `audio`) and the clip files beside it. Everything is sorted before
 * encoding, so the same source gives the same bytes on every machine.
 */
export function buildPack(source: unknown, clips: readonly ClipFile[]): BuildOutput {
  if (!isRecord(source)) throw new BuildError([{ path: '', message: 'source must be a JSON object' }])
  if ('audio' in source || 'schema_version' in source) {
    throw new BuildError([{ path: '', message: 'the audio manifest and the schema version are derived by the build, not written by hand' }])
  }
  const audio: PackAudioClip[] = [...clips]
    .sort((a, b) => byString(a.clipId, b.clipId))
    .map((c) => ({
      clip_id: c.clipId,
      url: `audio/${c.clipId}.${AUDIO_EXT}`,
      sha256: sha256Hex(c.bytes),
      bytes: c.bytes.byteLength,
      mime: AUDIO_MIME,
    }))
  const result = validatePack({ ...source, schema_version: PACK_SCHEMA_VERSION, audio })
  if (result.status === 'unsupported_schema') throw new BuildError([{ path: 'schema_version', message: 'not supported by this build' }])
  if (result.status === 'invalid') throw new BuildError(result.errors)
  const pack: Pack = {
    ...result.pack,
    entries: [...result.pack.entries].sort((a, b) => byString(a.entry_id, b.entry_id)),
    units: [...result.pack.units].sort((a, b) => a.order - b.order),
    themes: [...result.pack.themes].sort((a, b) => byString(a.theme_id, b.theme_id)),
  }
  const packBytes = new TextEncoder().encode(canonicalJson(pack))
  const packFile = `corpus-v${pack.corpus_version}-${pack.l1}.pack`
  const manifest: PackManifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    corpus_version: pack.corpus_version,
    packs: [
      {
        pack_id: pack.pack_id,
        l1: pack.l1,
        corpus_version: pack.corpus_version,
        schema_version: pack.schema_version,
        url: packFile,
        sha256: sha256Hex(packBytes),
        bytes: packBytes.byteLength,
      },
    ],
  }
  return { pack, packFile, packBytes, manifest }
}
