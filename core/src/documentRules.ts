import { validateSettingsPatch } from './settings'
import type { DocumentWrite } from './syncProtocol'
import { ID } from './validation'
import { isWordId } from './wordId'

/** The document types of Phase 1a (spec §6.2, §8.8, §8.10). Client and server read them from here. */
export const DOCUMENT_TYPES = {
  settings: 'settings',
  wordFlag: 'word_flag',
  unitUnlock: 'unit_unlock',
  wordAlias: 'word_alias',
  entitlement: 'entitlement',
  contentReport: 'content_report',
} as const
export type DocumentType = (typeof DOCUMENT_TYPES)[keyof typeof DOCUMENT_TYPES]

/** Types only the server writes — whether or not a copy exists yet (spec §8.8, §9.2; plan 2 contract). */
export const SERVER_OWNED_DOCUMENT_TYPES: ReadonlySet<string> = new Set<string>([DOCUMENT_TYPES.entitlement])

/** What a learner can report about a card (spec §8.10). */
export const REPORT_FIELDS = ['translation', 'example', 'audio', 'level', 'other'] as const
export type ReportField = (typeof REPORT_FIELDS)[number]

export const MAX_REPORT_NOTE_LENGTH = 1000
export const MAX_UNLOCKED_UNITS = 2000
/** Characters of JSON in one patch's fields. */
export const MAX_DOCUMENT_BYTES = 16_384
export const MAX_KEY_LENGTH = 128
/** The largest pack version a report may name: the server stores it in a 32-bit integer column. */
export const MAX_PACK_VERSION = 2_147_483_647

export type DocumentWriteCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'server_owned' | 'invalid'; readonly errors: readonly string[] }

const isCount = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

const unknownFields = (fields: Readonly<Record<string, unknown>>, allowed: readonly string[]): string[] =>
  Object.keys(fields)
    .filter((key) => !allowed.includes(key))
    .map((key) => `unknown field ${key}`)

function checkFields(type: string, key: string, fields: Readonly<Record<string, unknown>>): string[] {
  switch (type) {
    case DOCUMENT_TYPES.settings: {
      const result = validateSettingsPatch({ ...fields })
      return [
        ...(key === '' ? [] : ['the settings key must be empty']),
        ...(result.ok ? [] : result.errors.map((field) => `invalid setting ${field}`)),
      ]
    }
    case DOCUMENT_TYPES.wordFlag: {
      const flag = fields['flag']
      return [
        ...(isWordId(key) ? [] : ['a flag key must be a word ID']),
        ...(flag === undefined || flag === 'known' || flag === 'suspended' ? [] : ['flag must be known or suspended']),
        ...unknownFields(fields, ['flag']),
      ]
    }
    case DOCUMENT_TYPES.unitUnlock: {
      const units = fields['units']
      const valid =
        units === undefined ||
        (Array.isArray(units) && units.length <= MAX_UNLOCKED_UNITS && units.every((u) => typeof u === 'string' && ID.test(u)))
      return [
        ...(key === '' ? [] : ['the unlock key must be empty']),
        ...(valid ? [] : ['units must be a list of unit IDs']),
        ...unknownFields(fields, ['units']),
      ]
    }
    case DOCUMENT_TYPES.wordAlias: {
      // `u:` → `c:` only: no corpus ID is ever a key, so no chain and no cycle (roadmap contract).
      const target = fields['target']
      return [
        ...(isWordId(key) && key.startsWith('u:') ? [] : ['an alias key must be a user word ID']),
        ...(target === undefined || (typeof target === 'string' && isWordId(target) && target.startsWith('c:'))
          ? []
          : ['an alias target must be a corpus word ID']),
        ...unknownFields(fields, ['target']),
      ]
    }
    case DOCUMENT_TYPES.contentReport: {
      const { wordId, field, note, packVersion, createdAt } = fields
      return [
        ...(ID.test(key) ? [] : ['a report key must be an ID']),
        ...(typeof wordId === 'string' && isWordId(wordId) ? [] : ['wordId must be a word ID']),
        ...((REPORT_FIELDS as readonly unknown[]).includes(field) ? [] : ['field must be a report field']),
        ...(typeof note === 'string' && note.length <= MAX_REPORT_NOTE_LENGTH ? [] : [`note must be text of at most ${MAX_REPORT_NOTE_LENGTH} characters`]),
        ...(isCount(packVersion) && (packVersion as number) <= MAX_PACK_VERSION ? [] : [`packVersion must be an integer from 0 to ${MAX_PACK_VERSION}`]),
        ...(isCount(createdAt) ? [] : ['createdAt must be a time']),
        ...unknownFields(fields, ['wordId', 'field', 'note', 'packVersion', 'createdAt']),
      ]
    }
    default:
      return [`unknown document type ${type}`]
  }
}

/**
 * The checks a document write must pass before the server merges it (spec
 * §9.2): a server-owned type is refused as such; anything else is refused as
 * invalid if its key or fields break the type's rules. A refusal is
 * deterministic, so a client that drops the write loses nothing a retry
 * would have saved (plan 4 contract).
 */
export function checkDocumentWrite(write: DocumentWrite): DocumentWriteCheck {
  if (SERVER_OWNED_DOCUMENT_TYPES.has(write.type)) {
    return { ok: false, reason: 'server_owned', errors: [`${write.type} is written by the server only`] }
  }
  const fields = write.patch.fields as Readonly<Record<string, unknown>>
  const errors = checkFields(write.type, write.key, fields)
  if (write.key.length > MAX_KEY_LENGTH) errors.push(`the key is longer than ${MAX_KEY_LENGTH} characters`)
  if (JSON.stringify(fields).length > MAX_DOCUMENT_BYTES) errors.push(`the fields are larger than ${MAX_DOCUMENT_BYTES} characters`)
  return errors.length === 0 ? { ok: true } : { ok: false, reason: 'invalid', errors }
}
