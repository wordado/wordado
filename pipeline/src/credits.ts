import { CREDITS_SCHEMA_VERSION, validateCredits, type CreditsFile } from '@wordado/core'
import type { SourceRecord } from './sources'

/** `credits.json` (plan 8b, Decision 1): each cleared source whose licence requires an attribution, in register order. */
export function creditsFile(sources: readonly { readonly record: SourceRecord }[], corpusVersion: number): CreditsFile {
  return {
    schema_version: CREDITS_SCHEMA_VERSION,
    corpus_version: corpusVersion,
    sources: sources.filter((s) => s.record.attribution.trim() !== '').map((s) => ({ source: s.record.title, attribution: s.record.attribution })),
  }
}

/**
 * Builds `credits.json` and checks it is one the app will accept, before anything writes it (review fix for the
 * one-off `corpus credits` run, which has no other publishable gate). Throws, naming the source, when one needs an
 * attribution but has a blank title — the app would otherwise silently reject the file `creditsFile` built.
 */
export function checkedCredits(sources: readonly { readonly record: SourceRecord }[], corpusVersion: number): CreditsFile {
  const file = creditsFile(sources, corpusVersion)
  if (validateCredits(file) !== null) return file
  const blank = sources.find((s) => s.record.attribution.trim() !== '' && s.record.title.trim() === '')
  throw new Error(blank ? `${blank.record.id}: has an attribution but no title, so credits.json would be rejected` : 'credits.json built an invalid file')
}
