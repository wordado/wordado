import type { LocalizedText } from './types'

/** One problem with a pack or manifest; `path` is a JSON path such as `entries[3].audio.uk`. */
export interface PackError {
  readonly path: string
  readonly message: string
}

export class Report {
  readonly errors: PackError[] = []
  add(path: string, message: string): void {
    this.errors.push({ path, message })
  }
}

export type Raw = Record<string, unknown>

export function isRecord(value: unknown): value is Raw {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The key pattern of a `c:` word ID, reused for every ID in a pack. */
export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const LANG = /^[a-z]{2}$/
export const SHA256 = /^[0-9a-f]{64}$/
/** A relative path: no leading slash, no scheme, and no `..` segment (checked separately). */
export const RELATIVE_URL = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

// Locale-independent by construction: the same duplicate is a duplicate everywhere.
export const norm = (s: string): string => s.trim().normalize('NFC').toLowerCase()

export const at = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`)

export function text(r: Report, raw: Raw, key: string, path: string, nonEmpty = true): string {
  const v = raw[key]
  if (typeof v !== 'string') {
    r.add(at(path, key), 'must be a string')
    return ''
  }
  if (nonEmpty && v.trim() === '') r.add(at(path, key), 'must not be empty')
  else if (v !== v.trim()) r.add(at(path, key), 'must not start or end with whitespace')
  return v
}

export function texts(r: Report, raw: Raw, key: string, path: string): string[] {
  const v = raw[key]
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.trim() !== '' && x === x.trim())) {
    r.add(at(path, key), 'must be an array of non-empty strings without leading or trailing whitespace')
    return []
  }
  return v as string[]
}

export function integer(r: Report, raw: Raw, key: string, path: string, min: number): number {
  const v = raw[key]
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) {
    r.add(at(path, key), `must be an integer of at least ${min}`)
    return min
  }
  return v
}

export function bool(r: Report, raw: Raw, key: string, path: string): boolean {
  const v = raw[key]
  if (typeof v !== 'boolean') {
    r.add(at(path, key), 'must be true or false')
    return false
  }
  return v
}

export function oneOf<T extends string>(r: Report, raw: Raw, key: string, path: string, allowed: readonly T[]): T {
  const v = raw[key]
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    r.add(at(path, key), `must be one of ${allowed.join(', ')}`)
    return allowed[0]!
  }
  return v as T
}

export function localized(r: Report, raw: Raw, key: string, path: string): LocalizedText {
  const v = raw[key]
  if (!isRecord(v)) {
    r.add(at(path, key), 'must be an object with "en" and "l1"')
    return { en: '', l1: '' }
  }
  return { en: text(r, v, 'en', at(path, key)), l1: text(r, v, 'l1', at(path, key)) }
}

/** The objects of an array field; non-objects are reported and dropped. */
export function records(r: Report, raw: Raw, key: string, path: string): Raw[] {
  const v = raw[key]
  if (!Array.isArray(v)) {
    r.add(at(path, key), 'must be an array')
    return []
  }
  return v.flatMap((item, i) => {
    if (isRecord(item)) return [item]
    r.add(`${at(path, key)}[${i}]`, 'must be an object')
    return []
  })
}

export function id(r: Report, raw: Raw, key: string, path: string): string {
  const v = text(r, raw, key, path)
  if (v !== '' && !ID.test(v)) {
    r.add(at(path, key), 'must start with a letter or digit and contain only letters, digits, ".", "_" and "-"')
  }
  return v
}

export function relativeUrl(r: Report, raw: Raw, key: string, path: string): string {
  const v = text(r, raw, key, path)
  if (v !== '' && (!RELATIVE_URL.test(v) || v.split('/').includes('..'))) {
    r.add(at(path, key), 'must be a relative path without ".."')
  }
  return v
}

export function sha256(r: Report, raw: Raw, key: string, path: string): string {
  const v = text(r, raw, key, path)
  if (v !== '' && !SHA256.test(v)) r.add(at(path, key), 'must be 64 lowercase hex digits')
  return v
}

/** Reports the second and later occurrences of a key. */
export function checkUnique(r: Report, keys: readonly string[], pathOf: (i: number) => string, what: string): void {
  const seen = new Set<string>()
  keys.forEach((key, i) => {
    if (seen.has(key)) r.add(pathOf(i), `duplicate ${what} ${JSON.stringify(key)}`)
    seen.add(key)
  })
}
