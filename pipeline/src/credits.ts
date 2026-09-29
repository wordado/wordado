import { CREDITS_SCHEMA_VERSION, type CreditsFile } from '@wordado/core'
import type { SourceRecord } from './sources'

/** `credits.json` (plan 8b, Decision 1): each cleared source whose licence requires an attribution, in register order. */
export function creditsFile(sources: readonly { readonly record: SourceRecord }[], corpusVersion: number): CreditsFile {
  return {
    schema_version: CREDITS_SCHEMA_VERSION,
    corpus_version: corpusVersion,
    sources: sources.filter((s) => s.record.attribution.trim() !== '').map((s) => ({ source: s.record.title, attribution: s.record.attribution })),
  }
}
