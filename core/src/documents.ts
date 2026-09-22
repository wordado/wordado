/**
 * Versioned documents: user words, settings, unit unlocks, word aliases,
 * word flags. Server-owned documents: the entitlement, league membership.
 * Only the server assigns versions (spec §9.2).
 */
export type DocumentClass = 'versioned' | 'server_owned'

export interface VersionedDocument<T extends object> {
  readonly version: number
  readonly fields: T
  /** Per field, the version at which it last changed: all the history a merge needs. */
  readonly fieldVersions: Readonly<Partial<Record<keyof T, number>>>
  /** A tombstone. Retained with its fields, so undeleting restores them. */
  readonly deleted: boolean
}

/** A client write: the changed fields only, plus the version it was editing. */
export interface DocumentPatch<T extends object> {
  readonly baseVersion: number
  readonly fields: Readonly<Partial<T>>
  /** True deletes, false undeletes, absent leaves the tombstone as it is. */
  readonly deleted?: boolean
}

export type PatchResult<T extends object> =
  | {
      readonly accepted: true
      readonly document: VersionedDocument<T>
      /** False when baseVersion was current; true when the write was merged field by field. */
      readonly merged: boolean
    }
  | { readonly accepted: false; readonly reason: 'server_owned' | 'base_ahead_of_server' | 'version_not_newer' }

export function createDocument<T extends object>(fields: T, version: number): VersionedDocument<T> {
  const fieldVersions: Partial<Record<keyof T, number>> = {}
  for (const key of Object.keys(fields) as (keyof T)[]) fieldVersions[key] = version
  return { version, fields, fieldVersions, deleted: false }
}

/**
 * Applies a client patch on the server. A current base is accepted outright.
 * A stale base is merged field by field: a field unchanged on the server since
 * the base is applied, and for a field changed on both sides the write that
 * reaches the server later — this one — wins. Either way, fields the patch
 * does not mention are kept, and ordering is by arrival, never by a client
 * clock (spec §9.2).
 */
export function applyPatch<T extends object>(
  document: VersionedDocument<T>,
  patch: DocumentPatch<T>,
  nextVersion: number,
  documentClass: DocumentClass = 'versioned',
): PatchResult<T> {
  if (documentClass === 'server_owned') return { accepted: false, reason: 'server_owned' }
  if (patch.baseVersion > document.version) return { accepted: false, reason: 'base_ahead_of_server' }
  if (nextVersion <= document.version) return { accepted: false, reason: 'version_not_newer' }
  const fields = { ...document.fields }
  const fieldVersions: Partial<Record<keyof T, number>> = { ...document.fieldVersions }
  for (const key of Object.keys(patch.fields) as (keyof T)[]) {
    const value = patch.fields[key]
    if (value === undefined) continue
    fields[key] = value as T[keyof T]
    fieldVersions[key] = nextVersion
  }
  return {
    accepted: true,
    merged: patch.baseVersion < document.version,
    document: { version: nextVersion, fields, fieldVersions, deleted: patch.deleted ?? document.deleted },
  }
}

/** `unit_unlock` is a grow-only set: merge is union, and nothing re-locks a unit (spec §9.2). */
export function mergeUnlockSets(...sets: Iterable<string>[]): Set<string> {
  const out = new Set<string>()
  for (const set of sets) for (const id of set) out.add(id)
  return out
}
