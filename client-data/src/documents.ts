import { mergeUnlockSets, type DocumentClass, type DocumentPatch, type DocumentWrite, type WireDocument } from '@wordado/core'
import type { SqlDriver } from './driver'

export type Fields = Record<string, unknown>

/** A document as the client holds it: the last server copy, with any unsynced edit applied and kept as `patch`. */
export interface StoredDocument {
  readonly type: string
  readonly key: string
  readonly class: DocumentClass
  readonly version: number
  readonly fields: Fields
  readonly fieldVersions: Record<string, number>
  readonly deleted: boolean
  readonly staleAfter: number | null
  /** The one pending write, or null when the server has everything. */
  readonly patch: DocumentPatch<Fields> | null
}

/** The grow-only set (spec §9.2): unioned locally and against the server, never re-locked. */
export const UNLOCK_TYPE = 'unit_unlock'

interface Row {
  type: string
  key: string
  class: DocumentClass
  version: number
  fields: string
  field_versions: string
  deleted: number
  stale_after: number | null
  patch: string | null
}

function fromRow(row: Row): StoredDocument {
  return {
    type: row.type,
    key: row.key,
    class: row.class,
    version: row.version,
    fields: JSON.parse(row.fields) as Fields,
    fieldVersions: JSON.parse(row.field_versions) as Record<string, number>,
    deleted: row.deleted === 1,
    staleAfter: row.stale_after,
    patch: row.patch === null ? null : (JSON.parse(row.patch) as DocumentPatch<Fields>),
  }
}

async function put(tx: SqlDriver, doc: StoredDocument): Promise<void> {
  await tx.run(
    `INSERT INTO document (type, key, class, version, fields, field_versions, deleted, stale_after, patch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (type, key) DO UPDATE SET class = excluded.class, version = excluded.version, fields = excluded.fields,
       field_versions = excluded.field_versions, deleted = excluded.deleted, stale_after = excluded.stale_after, patch = excluded.patch`,
    [
      doc.type,
      doc.key,
      doc.class,
      doc.version,
      JSON.stringify(doc.fields),
      JSON.stringify(doc.fieldVersions),
      doc.deleted ? 1 : 0,
      doc.staleAfter,
      doc.patch === null ? null : JSON.stringify(doc.patch),
    ],
  )
}

export async function getDocument(driver: SqlDriver, type: string, key: string): Promise<StoredDocument | null> {
  const rows = await driver.all<Row>('SELECT * FROM document WHERE type = ? AND key = ?', [type, key])
  return rows[0] ? fromRow(rows[0]) : null
}

export async function listDocuments(driver: SqlDriver, type: string): Promise<StoredDocument[]> {
  const rows = await driver.all<Row>('SELECT * FROM document WHERE type = ? ORDER BY key', [type])
  return rows.map(fromRow)
}

const unitsOf = (fields: Fields): string[] => (Array.isArray(fields['units']) ? (fields['units'] as unknown[]).filter((u): u is string => typeof u === 'string') : [])

function unionUnits(a: Fields, b: Fields): Fields {
  return { units: [...mergeUnlockSets(unitsOf(a), unitsOf(b))].sort() }
}

function mergeFields(type: string, base: Fields, fields: Fields): Fields {
  return type === UNLOCK_TYPE ? unionUnits(base, fields) : { ...base, ...fields }
}

const EMPTY = (type: string, key: string): StoredDocument => ({
  type,
  key,
  class: 'versioned',
  version: 0,
  fields: {},
  fieldVersions: {},
  deleted: false,
  staleAfter: null,
  patch: null,
})

/**
 * A local edit (spec §9.2): applied to the stored copy at once and folded into
 * the one pending patch, whose `baseVersion` is the version the first pending
 * edit was made against. A document that does not exist yet is created at
 * version 0. `deleted` true tombstones, false undeletes, absent leaves it.
 */
export async function writeLocalPatch(tx: SqlDriver, type: string, key: string, fields: Fields, deleted?: boolean): Promise<StoredDocument> {
  const existing = await getDocument(tx, type, key)
  if (existing?.class === 'server_owned') throw new Error(`${type} is server-owned and cannot be written by a client`)
  const base = existing ?? EMPTY(type, key)
  const pendingDeleted = deleted ?? base.patch?.deleted
  const patch: DocumentPatch<Fields> = {
    baseVersion: base.patch?.baseVersion ?? base.version,
    fields: mergeFields(type, base.patch?.fields ?? {}, fields),
    ...(pendingDeleted === undefined ? {} : { deleted: pendingDeleted }),
  }
  const doc: StoredDocument = { ...base, fields: mergeFields(type, base.fields, fields), deleted: deleted ?? base.deleted, patch }
  await put(tx, doc)
  return doc
}

function fromWire(wire: WireDocument, fields: Fields, deleted: boolean, patch: DocumentPatch<Fields> | null): StoredDocument {
  return {
    type: wire.type,
    key: wire.key,
    class: wire.class,
    version: wire.version,
    fields,
    fieldVersions: wire.fieldVersions,
    deleted,
    staleAfter: wire.staleAfter,
    patch,
  }
}

/**
 * The server's copy, from a pull: it replaces the stored copy, and a pending
 * edit is re-applied on top so the learner's unsynced change stays visible
 * until the push settles it. Unit unlocks are unioned (spec §9.2).
 */
export async function applyServerDocument(tx: SqlDriver, wire: WireDocument): Promise<StoredDocument> {
  const existing = await getDocument(tx, wire.type, wire.key)
  const patch = existing?.patch ?? null
  const fields =
    wire.type === UNLOCK_TYPE && existing ? unionUnits(wire.fields, existing.fields) : patch ? mergeFields(wire.type, wire.fields, patch.fields) : wire.fields
  const doc = fromWire(wire, fields, patch?.deleted ?? wire.deleted, patch)
  await put(tx, doc)
  return doc
}

/**
 * The server's result for a pushed patch. If the stored patch is still the
 * one that was sent, it is cleared; if an edit was folded in meanwhile, the
 * result is applied like a pull and the newer patch stays pending.
 */
export async function confirmPushedDocument(tx: SqlDriver, wire: WireDocument, sent: DocumentPatch<Fields>): Promise<StoredDocument> {
  const existing = await getDocument(tx, wire.type, wire.key)
  if (existing?.patch && JSON.stringify(existing.patch) !== JSON.stringify(sent)) return applyServerDocument(tx, wire)
  const doc = fromWire(wire, wire.fields, wire.deleted, null)
  await put(tx, doc)
  return doc
}

/** Every pending patch, for page 0 of a push. */
export async function pendingDocumentWrites(driver: SqlDriver): Promise<DocumentWrite[]> {
  const rows = await driver.all<Row>('SELECT * FROM document WHERE patch IS NOT NULL ORDER BY type, key')
  return rows.map(fromRow).flatMap((d) => (d.patch ? [{ type: d.type, key: d.key, patch: d.patch }] : []))
}

/** Forgets a pending patch the server rejected; the next pull restores the server's fields. */
export async function dropPendingPatch(tx: SqlDriver, type: string, key: string): Promise<void> {
  await tx.run('UPDATE document SET patch = NULL WHERE type = ? AND key = ?', [type, key])
}
