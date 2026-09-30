import {
  DOCUMENT_TYPES,
  ENTITLEMENT_SOURCES,
  ENTITLEMENT_TIERS,
  REPORT_FIELDS,
  isSupportedL1,
  isWordId,
  settingsFromFields,
  validateSettingsPatch,
  type Entitlement,
  type ReportField,
  type ReportRecord,
  type Settings,
  type WordFlag,
  type WordId,
} from '@wordado/core'
import { getDocument, listDocuments, writeLocalPatch, type Fields } from './documents'
import type { SqlDriver } from './driver'
import type { ClientEnv } from './env'

/** The document types of Phase 1a (spec §6.2, §8.8, §8.10), as core names them. */
export const DOC = DOCUMENT_TYPES

export type { ReportField }

/** Settings with defaults; a stored field that fails validation is ignored rather than trusted. */
export async function readSettings(driver: SqlDriver): Promise<Settings> {
  const doc = await getDocument(driver, DOC.settings, '')
  return settingsFromFields(doc?.fields ?? {})
}

/** Validates (roadmap contract) and writes a settings patch. */
export async function patchSettings(tx: SqlDriver, patch: Record<string, unknown>): Promise<Settings> {
  const result = validateSettingsPatch(patch)
  if (!result.ok) throw new Error(`Invalid settings: ${result.errors.join(', ')}`)
  await writeLocalPatch(tx, DOC.settings, '', result.fields as Fields)
  return readSettings(tx)
}

export async function readFlags(driver: SqlDriver): Promise<Map<WordId, WordFlag>> {
  const out = new Map<WordId, WordFlag>()
  for (const doc of await listDocuments(driver, DOC.wordFlag)) {
    const flag = doc.fields['flag']
    if (!doc.deleted && (flag === 'known' || flag === 'suspended') && isWordId(doc.key)) out.set(doc.key, flag)
  }
  return out
}

/** A flag is a document per word; clearing it is a tombstone, so undoing restores it (spec §7.4, §9.2). */
export async function setFlag(tx: SqlDriver, wordId: WordId, flag: WordFlag | null): Promise<void> {
  if (flag === null) await writeLocalPatch(tx, DOC.wordFlag, wordId, {}, true)
  else await writeLocalPatch(tx, DOC.wordFlag, wordId, { flag }, false)
}

export async function readUnlocks(driver: SqlDriver): Promise<Set<string>> {
  const doc = await getDocument(driver, DOC.unitUnlock, '')
  const units = doc?.fields['units']
  return new Set(Array.isArray(units) ? units.filter((u): u is string => typeof u === 'string') : [])
}

export async function addUnlocks(tx: SqlDriver, unitIds: readonly string[]): Promise<void> {
  if (unitIds.length === 0) return
  await writeLocalPatch(tx, DOC.unitUnlock, '', { units: [...unitIds] })
}

/**
 * The cached server-owned entitlement (spec §8.8), or null before the first
 * pull and whenever the copy is not one this build understands (a tier or
 * source it does not know): null means the default tier, never a crash.
 */
export async function readEntitlement(driver: SqlDriver): Promise<Entitlement | null> {
  const doc = await getDocument(driver, DOC.entitlement, '')
  if (!doc || doc.deleted) return null
  const { tier, source, expiresAt, quotas } = doc.fields
  const perDay = (quotas as { enrichmentPerDay?: unknown } | null)?.enrichmentPerDay
  const valid =
    typeof tier === 'string' &&
    (ENTITLEMENT_TIERS as readonly string[]).includes(tier) &&
    typeof source === 'string' &&
    (ENTITLEMENT_SOURCES as readonly string[]).includes(source) &&
    (expiresAt === null || (typeof expiresAt === 'number' && Number.isFinite(expiresAt))) &&
    typeof perDay === 'number' &&
    Number.isInteger(perDay) &&
    perDay >= 0
  if (!valid) return null
  return {
    tier: tier as Entitlement['tier'],
    source: source as Entitlement['source'],
    expiresAt: expiresAt as number | null,
    quotas: { enrichmentPerDay: perDay },
    version: doc.version,
    staleAfter: doc.staleAfter ?? 0,
  }
}

/** user word → corpus entry merges (Phase 2); empty until then. */
export async function readAliases(driver: SqlDriver): Promise<Map<WordId, WordId>> {
  const out = new Map<WordId, WordId>()
  for (const doc of await listDocuments(driver, DOC.wordAlias)) {
    const target = doc.fields['target']
    if (!doc.deleted && isWordId(doc.key) && typeof target === 'string' && isWordId(target)) out.set(doc.key, target)
  }
  return out
}

export interface ContentReportInput {
  readonly wordId: WordId
  readonly field: ReportField
  readonly note: string
  readonly packVersion: number
  /** The learner's L1 when reporting (spec §8.10, plan 10). */
  readonly l1?: string
}

/** A report works offline and syncs like any document (spec §8.10). Returns its key. */
export async function addContentReport(tx: SqlDriver, env: ClientEnv, report: ContentReportInput): Promise<string> {
  const key = env.uuid()
  await writeLocalPatch(tx, DOC.contentReport, key, { ...report, createdAt: env.now() })
  return key
}

/** The learner's content reports, as this device holds them (they sync from the learner's other devices too). */
export async function readReports(driver: SqlDriver): Promise<ReportRecord[]> {
  const out: ReportRecord[] = []
  for (const doc of await listDocuments(driver, DOC.contentReport)) {
    const { wordId, field, packVersion, l1 } = doc.fields
    if (doc.deleted || typeof wordId !== 'string' || !isWordId(wordId)) continue
    if (typeof field !== 'string' || !(REPORT_FIELDS as readonly string[]).includes(field)) continue
    out.push({
      key: doc.key,
      wordId,
      field: field as ReportRecord['field'],
      packVersion: typeof packVersion === 'number' ? packVersion : 0,
      ...(isSupportedL1(l1) ? { l1 } : {}),
    })
  }
  return out
}
