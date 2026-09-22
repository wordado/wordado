import {
  checkUnique,
  id,
  integer,
  isRecord,
  LANG,
  records,
  relativeUrl,
  Report,
  sha256,
  text,
  type PackError,
  type Raw,
} from './validation'

/** The manifest schema this build reads. Bump on any change an older client could not parse. */
export const MANIFEST_SCHEMA_VERSION = 1

/** One pack the manifest offers. `url` is relative to the manifest's own URL. */
export interface PackDescriptor {
  readonly pack_id: string
  readonly l1: string
  readonly corpus_version: number
  readonly schema_version: number
  readonly url: string
  readonly sha256: string
  readonly bytes: number
}

/**
 * A client's content is described by a list (spec §5.1): one item per pack,
 * each with its own version and checksum. `corpus_version` is the global
 * version; the list says which L1 packs exist at it.
 */
export interface PackManifest {
  readonly schema_version: number
  readonly corpus_version: number
  readonly packs: readonly PackDescriptor[]
}

export type ManifestValidation =
  | { readonly status: 'ok'; readonly manifest: PackManifest }
  | { readonly status: 'unsupported_schema'; readonly schemaVersion: number }
  | { readonly status: 'invalid'; readonly errors: readonly PackError[] }

function parseDescriptor(r: Report, raw: Raw, path: string): PackDescriptor {
  const l1 = text(r, raw, 'l1', path)
  if (l1 !== '' && !LANG.test(l1)) r.add(`${path}.l1`, 'must be a two-letter lowercase language code')
  return {
    pack_id: id(r, raw, 'pack_id', path),
    l1,
    corpus_version: integer(r, raw, 'corpus_version', path, 0),
    schema_version: integer(r, raw, 'schema_version', path, 1),
    url: relativeUrl(r, raw, 'url', path),
    sha256: sha256(r, raw, 'sha256', path),
    bytes: integer(r, raw, 'bytes', path, 1),
  }
}

export function validateManifest(
  value: unknown,
  supportedSchemaVersions: readonly number[] = [MANIFEST_SCHEMA_VERSION],
): ManifestValidation {
  if (!isRecord(value)) return { status: 'invalid', errors: [{ path: '', message: 'must be an object' }] }
  const schema = value['schema_version']
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
    return { status: 'invalid', errors: [{ path: 'schema_version', message: 'must be a positive integer' }] }
  }
  if (!supportedSchemaVersions.includes(schema)) return { status: 'unsupported_schema', schemaVersion: schema }
  const r = new Report()
  const manifest: PackManifest = {
    schema_version: schema,
    corpus_version: integer(r, value, 'corpus_version', '', 0),
    packs: records(r, value, 'packs', '').map((p, i) => parseDescriptor(r, p, `packs[${i}]`)),
  }
  checkUnique(r, manifest.packs.map((p) => p.pack_id), (i) => `packs[${i}].pack_id`, 'pack_id')
  return r.errors.length > 0 ? { status: 'invalid', errors: r.errors } : { status: 'ok', manifest }
}

/** What the client already holds, per pack. */
export interface InstalledPack {
  readonly pack_id: string
  readonly corpus_version: number
  readonly schema_version: number
}

export interface PackSelectionInput {
  readonly manifest: PackManifest
  readonly l1: string
  readonly installed: readonly InstalledPack[]
  /** Normally `[PACK_SCHEMA_VERSION]`. */
  readonly supportedSchemaVersions: readonly number[]
}

export interface PackSelection {
  /** Newer packs to download, verify and swap in at the start of the next session (spec §5.1). */
  readonly fetch: readonly PackDescriptor[]
  /** Newer packs whose schema this build cannot read: keep the installed one and ask the learner to update the app. */
  readonly appUpdateNeeded: readonly PackDescriptor[]
}

/** Which of the manifest's packs a client of `l1` should fetch (spec §5.1, §9.3). */
export function selectPacks(input: PackSelectionInput): PackSelection {
  const fetch: PackDescriptor[] = []
  const appUpdateNeeded: PackDescriptor[] = []
  for (const offered of input.manifest.packs) {
    if (offered.l1 !== input.l1) continue
    const have = input.installed.find((p) => p.pack_id === offered.pack_id)
    if (have && have.corpus_version >= offered.corpus_version) continue
    if (input.supportedSchemaVersions.includes(offered.schema_version)) fetch.push(offered)
    else appUpdateNeeded.push(offered)
  }
  return { fetch, appUpdateNeeded }
}
