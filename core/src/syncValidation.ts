import { isoDateToDay } from './calendar'
import type { DocumentPatch } from './documents'
import { MAX_KEY_LENGTH } from './documentRules'
import { isValidTzOffset } from './settings'
import { SYNC_PAGE_SIZE, type DocumentWrite, type PullRequest, type PushPage, type WireDayComplete } from './syncProtocol'
import type { Direction, Grade, Mode, ReviewEvent } from './types'
import { ID, isRecord } from './validation'
import { isWordId, type WordId } from './wordId'

export const MODES: readonly Mode[] = ['flashcard', 'multiple_choice', 'listening_select', 'matching']
export const DIRECTIONS: readonly Direction[] = ['en_to_l1', 'l1_to_en']

/** Document writes and completed days one push page may carry. Tuning (§15). */
export const MAX_PAGE_DOCUMENTS = 200
export const MAX_PAGE_DAY_COMPLETE = 400
/** reviewId, pushId, deviceId, schedulerVersion, ruleVersion. */
export const MAX_ID_LENGTH = 64
/** No answer takes an hour: a longer latency is stored as an hour (a left-open tab, a sleeping laptop). */
export const MAX_LATENCY_MS = 3_600_000

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly string[] }

const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min
const isId = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_ID_LENGTH && ID.test(v)
const isVersionText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH

/** A latency as it is stored: a whole number of milliseconds, at most an hour. */
export function normalizeLatencyMs(ms: number): number {
  return Math.min(MAX_LATENCY_MS, Math.max(0, Math.round(ms)))
}

/**
 * What an answer must be to be recorded at all (spec §9.2), in one place:
 * the client refuses to write an answer that fails it, and the server
 * refuses a push page carrying one, so nothing the client stores can wedge
 * its outbox. Shape only — a long latency is plausibility (Goal 7) and is
 * normalised, not refused. Returns the fields that fail.
 */
export function answerProblems(raw: Readonly<Record<string, unknown>>): string[] {
  const problems: string[] = []
  const check = (ok: boolean, field: string) => {
    if (!ok) problems.push(field)
  }
  check(typeof raw['wordId'] === 'string' && isWordId(raw['wordId']), 'wordId')
  check(MODES.includes(raw['mode'] as Mode), 'mode')
  check(DIRECTIONS.includes(raw['direction'] as Direction), 'direction')
  check(isInt(raw['grade'], 1) && raw['grade'] <= 4, 'grade')
  check(typeof raw['latencyMs'] === 'number' && Number.isFinite(raw['latencyMs']) && raw['latencyMs'] >= 0, 'latencyMs')
  check(typeof raw['practice'] === 'boolean', 'practice')
  // The roadmap contract: a NaN or impossible offset would poison a word's state for good.
  check(typeof raw['clientTzOffsetMin'] === 'number' && isValidTzOffset(raw['clientTzOffsetMin']), 'clientTzOffsetMin')
  return problems
}

function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false
  try {
    isoDateToDay(v)
    return true
  } catch {
    return false
  }
}

function list(raw: unknown, name: string, max: number, errors: string[]): unknown[] {
  if (!Array.isArray(raw)) {
    errors.push(`${name} must be a list`)
    return []
  }
  if (raw.length > max) {
    errors.push(`${name} has more than ${max} items`)
    return []
  }
  return raw
}

function parseEvent(raw: unknown, deviceId: unknown, path: string, errors: string[]): ReviewEvent | null {
  if (!isRecord(raw)) {
    errors.push(`${path} must be an object`)
    return null
  }
  const start = errors.length
  const check = (ok: boolean, field: string) => {
    if (!ok) errors.push(`${path}.${field} is invalid`)
  }
  check(isId(raw['reviewId']), 'reviewId')
  for (const field of answerProblems(raw)) errors.push(`${path}.${field} is invalid`)
  check(isInt(raw['clientTs'], 0), 'clientTs')
  check(raw['deviceId'] === deviceId, 'deviceId')
  check(isInt(raw['deviceSeq'], 0), 'deviceSeq')
  check(isVersionText(raw['schedulerVersion']), 'schedulerVersion')
  if (errors.length > start) return null
  return {
    reviewId: raw['reviewId'] as string,
    wordId: raw['wordId'] as WordId,
    mode: raw['mode'] as Mode,
    direction: raw['direction'] as Direction,
    grade: raw['grade'] as Grade,
    latencyMs: normalizeLatencyMs(raw['latencyMs'] as number),
    practice: raw['practice'] as boolean,
    clientTs: raw['clientTs'] as number,
    clientTzOffsetMin: raw['clientTzOffsetMin'] as number,
    deviceId: raw['deviceId'] as string,
    deviceSeq: raw['deviceSeq'] as number,
    schedulerVersion: raw['schedulerVersion'] as string,
  }
}

function parseDayComplete(raw: unknown, path: string, errors: string[]): WireDayComplete | null {
  if (!isRecord(raw) || !isIsoDate(raw['localDate']) || !isVersionText(raw['ruleVersion'])) {
    errors.push(`${path} is invalid`)
    return null
  }
  return { localDate: raw['localDate'], ruleVersion: raw['ruleVersion'] }
}

function parseDocumentWrite(raw: unknown, path: string, errors: string[]): DocumentWrite | null {
  if (!isRecord(raw)) {
    errors.push(`${path} must be an object`)
    return null
  }
  const { type, key, patch } = raw
  const start = errors.length
  if (typeof type !== 'string' || type === '' || type.length > MAX_ID_LENGTH) errors.push(`${path}.type is invalid`)
  if (typeof key !== 'string' || key.length > MAX_KEY_LENGTH) errors.push(`${path}.key is invalid`)
  const patchValid =
    isRecord(patch) &&
    isInt(patch['baseVersion'], 0) &&
    isRecord(patch['fields']) &&
    (patch['deleted'] === undefined || typeof patch['deleted'] === 'boolean')
  if (!patchValid) errors.push(`${path}.patch is invalid`)
  if (errors.length > start || !isRecord(patch)) return null
  const fields = { ...(patch['fields'] as Record<string, unknown>) }
  const out: DocumentPatch<Record<string, unknown>> =
    patch['deleted'] === undefined
      ? { baseVersion: patch['baseVersion'] as number, fields }
      : { baseVersion: patch['baseVersion'] as number, fields, deleted: patch['deleted'] as boolean }
  return { type: type as string, key: key as string, patch: out }
}

/**
 * The protocol version of anything shaped like a push or pull, read before
 * anything else: a client from before a protocol bump must get
 * `upgrade_required` even when the rest of its request no longer parses (spec §4.3).
 */
export function protocolVersionOf(raw: unknown): number | null {
  return isRecord(raw) && isInt(raw['protocolVersion'], 0) ? raw['protocolVersion'] : null
}

/**
 * An untrusted push page, checked field by field and rebuilt from the known
 * fields only (spec §9.2). Plausibility is not checked here — the server
 * stamps implausible answers and keeps them (Goal 7) — only shape.
 */
export function parsePushPage(raw: unknown): Parsed<PushPage> {
  if (!isRecord(raw)) return { ok: false, errors: ['the page must be an object'] }
  const errors: string[] = []
  const { protocolVersion, pushId, clientNow, deviceId, page, lastPage } = raw
  if (!isInt(protocolVersion, 1)) errors.push('protocolVersion is invalid')
  if (!isId(pushId)) errors.push('pushId is invalid')
  if (!isInt(clientNow, 0)) errors.push('clientNow is invalid')
  if (!isId(deviceId)) errors.push('deviceId is invalid')
  if (!isInt(page, 0)) errors.push('page is invalid')
  if (typeof lastPage !== 'boolean') errors.push('lastPage is invalid')
  const events = list(raw['events'], 'events', SYNC_PAGE_SIZE, errors).map((e, i) => parseEvent(e, deviceId, `events[${i}]`, errors))
  const dayComplete = list(raw['dayComplete'], 'dayComplete', MAX_PAGE_DAY_COMPLETE, errors).map((d, i) =>
    parseDayComplete(d, `dayComplete[${i}]`, errors),
  )
  const documents = list(raw['documents'], 'documents', MAX_PAGE_DOCUMENTS, errors).map((d, i) =>
    parseDocumentWrite(d, `documents[${i}]`, errors),
  )
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      protocolVersion: protocolVersion as number,
      pushId: pushId as string,
      clientNow: clientNow as number,
      deviceId: deviceId as string,
      page: page as number,
      lastPage: lastPage as boolean,
      events: events as ReviewEvent[],
      dayComplete: dayComplete as WireDayComplete[],
      documents: documents as DocumentWrite[],
    },
  }
}

export function parsePullRequest(raw: unknown): Parsed<PullRequest> {
  if (!isRecord(raw)) return { ok: false, errors: ['the request must be an object'] }
  const errors: string[] = []
  const { protocolVersion, deviceId, documentsSince } = raw
  if (!isInt(protocolVersion, 1)) errors.push('protocolVersion is invalid')
  if (!isId(deviceId)) errors.push('deviceId is invalid')
  if (!isInt(documentsSince, 0)) errors.push('documentsSince is invalid')
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: { protocolVersion: protocolVersion as number, deviceId: deviceId as string, documentsSince: documentsSince as number },
  }
}
