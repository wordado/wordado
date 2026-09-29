/** `credits.json` beside the manifest (plan 8b, Decision 1): the attributions the word-data sources' licences require. */
export const CREDITS_SCHEMA_VERSION = 1

export interface Credit {
  /** The source's title, as the licence register names it. */
  readonly source: string
  /** The licence's attribution, shown verbatim. */
  readonly attribution: string
}

export interface CreditsFile {
  readonly schema_version: 1
  readonly corpus_version: number
  readonly sources: readonly Credit[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** The file with only its known fields, or null for anything else (another schema included): the app then keeps what it had. */
export function validateCredits(value: unknown): CreditsFile | null {
  if (!isRecord(value) || value['schema_version'] !== CREDITS_SCHEMA_VERSION) return null
  const version = value['corpus_version']
  const sources = value['sources']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || !Array.isArray(sources)) return null
  const out: Credit[] = []
  for (const s of sources) {
    if (!isRecord(s) || !text(s['source']) || !text(s['attribution'])) return null
    out.push({ source: s['source'], attribution: s['attribution'] })
  }
  return { schema_version: CREDITS_SCHEMA_VERSION, corpus_version: version, sources: out }
}
