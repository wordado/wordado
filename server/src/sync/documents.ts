import {
  applyPatch,
  checkDocumentWrite,
  createDocument,
  DOCUMENT_TYPES,
  mergeUnlockSets,
  type DocumentClass,
  type DocumentRejection,
  type DocumentWrite,
  type VersionedDocument,
  type WireDocument,
} from '@wordado/core'
import type { Queryable } from '../db/db'

/** A `document` table row. */
export interface DocumentRow {
  readonly type: string
  readonly key: string
  readonly class: DocumentClass
  readonly version: number
  readonly fields: Record<string, unknown>
  readonly field_versions: Record<string, number>
  readonly deleted: boolean
}

export const DOCUMENT_COLUMNS = 'type, key, class, version, fields, field_versions, deleted'

/** A stored document on the wire. `staleAfter` applies to server-owned documents only (spec §9.2). */
export function toWire(row: DocumentRow, staleAfter: number | null): WireDocument {
  return {
    type: row.type,
    key: row.key,
    class: row.class,
    version: row.version,
    fields: row.fields,
    fieldVersions: row.field_versions,
    deleted: row.deleted,
    staleAfter: row.class === 'server_owned' ? staleAfter : null,
  }
}

const unitsOf = (fields: Readonly<Record<string, unknown>>): string[] =>
  Array.isArray(fields['units']) ? (fields['units'] as unknown[]).filter((u): u is string => typeof u === 'string') : []

/** Keeps the report where account deletion can anonymise it rather than erase it (spec §11). */
async function saveReport(tx: Queryable, userId: string, key: string, fields: Readonly<Record<string, unknown>>, serverNow: number): Promise<void> {
  await tx.query(
    `insert into content_report (reporter_id, report_key, word_id, field, note, pack_version, created_at, received_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (reporter_id, report_key) do update set word_id = excluded.word_id, field = excluded.field,
       note = excluded.note, pack_version = excluded.pack_version, created_at = excluded.created_at`,
    [userId, key, fields['wordId'], fields['field'], fields['note'], fields['packVersion'], fields['createdAt'], serverNow],
  )
}

export interface DocumentWriteResult {
  /** The server's copy of every document a write was accepted for, in write order. */
  readonly documents: WireDocument[]
  readonly rejected: DocumentRejection[]
  /** An alias was written: which events derive which word may have changed. */
  readonly aliasesChanged: boolean
}

/**
 * Applies a page's document writes (spec §9.2) under the learner's lock:
 * core's checks, then `applyPatch` with the next number of the learner's
 * one document counter (plan 4). A rejection spends no version, so the same
 * write is rejected the same way however often it is sent.
 */
export async function applyDocumentWrites(
  tx: Queryable,
  userId: string,
  documentVersion: number,
  writes: readonly DocumentWrite[],
  serverNow: number,
): Promise<DocumentWriteResult> {
  let version = documentVersion
  const documents: WireDocument[] = []
  const rejected: DocumentRejection[] = []
  let aliasesChanged = false
  for (const write of writes) {
    const reject = (reason: DocumentRejection['reason']) => rejected.push({ type: write.type, key: write.key, reason })
    const check = checkDocumentWrite(write)
    if (!check.ok) {
      reject(check.reason)
      continue
    }
    const [row] = await tx.query<DocumentRow>(`select ${DOCUMENT_COLUMNS} from document where user_id = $1 and type = $2 and key = $3`, [
      userId,
      write.type,
      write.key,
    ])
    if (row?.class === 'server_owned') {
      reject('server_owned')
      continue
    }
    const current: VersionedDocument<Record<string, unknown>> = row
      ? { version: row.version, fields: row.fields, fieldVersions: row.field_versions, deleted: row.deleted }
      : createDocument<Record<string, unknown>>({}, 0)
    // A grow-only set: the patch carries the union, so nothing can re-lock a unit.
    const patch =
      write.type === DOCUMENT_TYPES.unitUnlock
        ? { ...write.patch, fields: { units: [...mergeUnlockSets(unitsOf(current.fields), unitsOf(write.patch.fields))].sort() } }
        : write.patch
    const result = applyPatch(current, patch, version + 1)
    if (!result.accepted) {
      reject(result.reason)
      continue
    }
    version += 1
    const saved: DocumentRow = {
      type: write.type,
      key: write.key,
      class: 'versioned',
      version: result.document.version,
      fields: result.document.fields,
      field_versions: result.document.fieldVersions as Record<string, number>,
      deleted: result.document.deleted,
    }
    await tx.query(
      `insert into document (user_id, type, key, class, version, fields, field_versions, deleted)
       values ($1, $2, $3, 'versioned', $4, $5::jsonb, $6::jsonb, $7)
       on conflict (user_id, type, key) do update set version = excluded.version, fields = excluded.fields,
         field_versions = excluded.field_versions, deleted = excluded.deleted`,
      [userId, saved.type, saved.key, saved.version, JSON.stringify(saved.fields), JSON.stringify(saved.field_versions), saved.deleted],
    )
    if (write.type === DOCUMENT_TYPES.contentReport) await saveReport(tx, userId, write.key, saved.fields, serverNow)
    if (write.type === DOCUMENT_TYPES.wordAlias) aliasesChanged = true
    documents.push(toWire(saved, null))
  }
  if (version !== documentVersion) await tx.query('update learner set document_version = $2 where user_id = $1', [userId, version])
  return { documents, rejected, aliasesChanged }
}
