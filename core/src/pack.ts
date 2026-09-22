import type { Accent, CefrLevel, LocalizedText, PartOfSpeech } from './types'

/**
 * The pack schema this build of `core` reads (spec §5.1). Bump it on any
 * change a client of the previous version could not load; a client that
 * meets a newer schema keeps its current pack and asks for an app update.
 */
export const PACK_SCHEMA_VERSION = 1

/** One clip of the audio manifest. `url` is relative to the manifest that listed the pack (spec §9.3). */
export interface PackAudioClip {
  readonly clip_id: string
  readonly url: string
  readonly sha256: string
  readonly bytes: number
  readonly mime: string
}

/** One sense of a headword, as shipped (spec §5.2). */
export interface PackEntry {
  readonly entry_id: string
  readonly headword: string
  /** Accepted spellings (colour / color). */
  readonly variants: readonly string[]
  readonly pos: PartOfSpeech
  /** Sense gloss in the L1; empty when the headword alone is unambiguous. */
  readonly sense: string
  readonly ipa: string
  readonly level: CefrLevel
  readonly unit_id: string
  readonly themes: readonly string[]
  readonly translation: string
  readonly alternates: readonly string[]
  /** English example sentences; at least one for a live entry. */
  readonly examples: readonly string[]
  /** Clip IDs into the pack's audio manifest, by accent. */
  readonly audio: Readonly<Partial<Record<Accent, string>>>
  readonly retired: boolean
}

export interface PackUnit {
  readonly unit_id: string
  readonly level: CefrLevel
  /** Position in the path, unique across the packs a client loads. */
  readonly order: number
  readonly title: LocalizedText
  readonly entry_ids: readonly string[]
}

/** A curated theme (spec §8.9). Membership is on the entries; size decides whether it is offered. */
export interface PackTheme {
  readonly theme_id: string
  readonly name: LocalizedText
  readonly description: LocalizedText
}

/** A corpus pack as shipped: one JSON document per (corpus version, L1) (spec §5.1). */
export interface Pack {
  readonly schema_version: number
  readonly pack_id: string
  readonly corpus_version: number
  readonly l1: string
  readonly target: string
  readonly entries: readonly PackEntry[]
  readonly units: readonly PackUnit[]
  readonly themes: readonly PackTheme[]
  readonly audio: readonly PackAudioClip[]
}

/**
 * A pack's bytes are this string in UTF-8: keys sorted by code unit at every
 * depth, no whitespace, undefined fields dropped. The same content is the same
 * bytes on every machine, which is what makes the manifest's checksum mean
 * something (spec §5.1).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) out[key] = sortKeys(source[key])
    }
    return out
  }
  return value
}
