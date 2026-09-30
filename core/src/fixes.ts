import { REPORT_FIELDS, type ReportField } from './documentRules'
import { isWordId } from './wordId'

/** `fixes.json` beside the manifest (plan 8, Decision 16): every entry field a corpus version changed, cumulative. */
export const FIXES_SCHEMA_VERSION = 1

/** A report field a new corpus version can fix; "other" names nothing a pack carries. */
export type FixedField = Exclude<ReportField, 'other'>
const FIXED_FIELDS: readonly string[] = REPORT_FIELDS.filter((f) => f !== 'other')

export interface Fix {
  readonly word_id: string
  readonly field: FixedField
  readonly fixed_in: number
}

export interface FixesFile {
  readonly schema_version: 1
  readonly corpus_version: number
  readonly fixes: readonly Fix[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const version = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min

/** The file with only its known fields, or null for anything else (another schema included): the app then keeps what it had. */
export function validateFixes(value: unknown): FixesFile | null {
  if (!isRecord(value) || value['schema_version'] !== FIXES_SCHEMA_VERSION) return null
  const corpusVersion = value['corpus_version']
  const list = value['fixes']
  if (!version(corpusVersion, 0) || !Array.isArray(list)) return null
  const out: Fix[] = []
  for (const f of list) {
    if (!isRecord(f)) return null
    const wordId = f['word_id']
    const field = f['field']
    const fixedIn = f['fixed_in']
    if (typeof wordId !== 'string' || !isWordId(wordId) || typeof field !== 'string' || !FIXED_FIELDS.includes(field) || !version(fixedIn, 1)) return null
    out.push({ word_id: wordId, field: field as FixedField, fixed_in: fixedIn })
  }
  return { schema_version: FIXES_SCHEMA_VERSION, corpus_version: corpusVersion, fixes: out }
}

/** A learner's content report, as the client holds it (spec §8.10). */
export interface ReportRecord {
  readonly key: string
  readonly wordId: string
  readonly field: ReportField
  /** The corpus version the learner had when reporting. */
  readonly packVersion: number
}

export interface FixedReport {
  readonly report: ReportRecord
  readonly fix: Fix
}

/**
 * The reports a fix answers (plan 8b, Decision 4): same word and field, a fix
 * that came after the report, in a version the learner has installed. Each
 * report is matched to its first such fix.
 */
export function fixedReports(reports: readonly ReportRecord[], fixes: FixesFile, installed: number | null): FixedReport[] {
  if (installed === null) return []
  const out: FixedReport[] = []
  for (const report of reports) {
    const fix = fixes.fixes
      .filter((f) => f.word_id === report.wordId && f.field === report.field && f.fixed_in > report.packVersion && f.fixed_in <= installed)
      .sort((a, b) => a.fixed_in - b.fixed_in)[0]
    if (fix) out.push({ report, fix })
  }
  return out
}
