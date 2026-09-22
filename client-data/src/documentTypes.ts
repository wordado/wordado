import {
  DEFAULT_SETTINGS,
  isWordId,
  validateSettingsPatch,
  type Entitlement,
  type Settings,
  type WordFlag,
  type WordId,
} from '@wordado/core'
import { getDocument, listDocuments, UNLOCK_TYPE, writeLocalPatch, type Fields } from './documents'
import type { SqlDriver } from './driver'
import type { ClientEnv } from './env'

/** The document types of Phase 1a (spec §6.2, §8.8, §8.10). */
export const DOC = {
  settings: 'settings',
  wordFlag: 'word_flag',
  unitUnlock: UNLOCK_TYPE,
  wordAlias: 'word_alias',
  entitlement: 'entitlement',
  contentReport: 'content_report',
} as const

/** Settings with defaults; a stored field that fails validation is ignored rather than trusted. */
export async function readSettings(driver: SqlDriver): Promise<Settings> {
  const doc = await getDocument(driver, DOC.settings, '')
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const [key, value] of Object.entries(doc?.fields ?? {})) {
    const result = validateSettingsPatch({ [key]: value })
    if (result.ok) Object.assign(out, result.fields)
  }
  return out as unknown as Settings
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

/** The cached server-owned entitlement (spec §8.8), or null before the first pull. */
export async function readEntitlement(driver: SqlDriver): Promise<Entitlement | null> {
  const doc = await getDocument(driver, DOC.entitlement, '')
  if (!doc) return null
  const fields = doc.fields as unknown as Omit<Entitlement, 'version' | 'staleAfter'>
  return { ...fields, version: doc.version, staleAfter: doc.staleAfter ?? 0 }
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

export type ReportField = 'translation' | 'example' | 'audio' | 'level' | 'other'

export interface ContentReportInput {
  readonly wordId: WordId
  readonly field: ReportField
  readonly note: string
  readonly packVersion: number
}

/** A report works offline and syncs like any document (spec §8.10). Returns its key. */
export async function addContentReport(tx: SqlDriver, env: ClientEnv, report: ContentReportInput): Promise<string> {
  const key = env.uuid()
  await writeLocalPatch(tx, DOC.contentReport, key, { ...report, createdAt: env.now() })
  return key
}
