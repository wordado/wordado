import {
  localDay,
  utcDay,
  type Direction,
  type EventKind,
  type Grade,
  type Mode,
  type StampedReviewEvent,
  type WordId,
} from '@wordado/core'
import type { Queryable } from '../db/db'

/** A stored event, with core's classification and award as last derived. */
export interface StoredEvent extends StampedReviewEvent {
  readonly kind: EventKind
  readonly xpAward: number
}

export interface EventRow {
  readonly review_id: string
  readonly word_id: string
  readonly mode: string
  readonly direction: string
  readonly grade: number
  readonly latency_ms: number
  readonly practice: boolean
  readonly client_ts: number
  readonly client_tz_offset_min: number
  readonly device_id: string
  readonly device_seq: number
  readonly scheduler_version: string
  readonly received_at: number
  readonly effective_ts: number
  readonly xp_eligible: boolean
  readonly kind: string
  readonly xp_award: number
}

export const EVENT_COLUMNS = `review_id, word_id, mode, direction, grade, latency_ms, practice, client_ts, client_tz_offset_min,
  device_id, device_seq, scheduler_version, received_at, effective_ts, xp_eligible, kind, xp_award`

export function toStoredEvent(r: EventRow): StoredEvent {
  return {
    reviewId: r.review_id,
    wordId: r.word_id as WordId,
    mode: r.mode as Mode,
    direction: r.direction as Direction,
    grade: r.grade as Grade,
    latencyMs: r.latency_ms,
    practice: r.practice,
    clientTs: r.client_ts,
    clientTzOffsetMin: r.client_tz_offset_min,
    deviceId: r.device_id,
    deviceSeq: r.device_seq,
    schedulerVersion: r.scheduler_version,
    receivedAt: r.received_at,
    effectiveTs: r.effective_ts,
    xpEligible: r.xp_eligible,
    kind: r.kind as EventKind,
    xpAward: r.xp_award,
  }
}

/** The event as the client and the stamp made it, without the server's derived columns. */
export function toStampedEvent(e: StoredEvent): StampedReviewEvent {
  const { kind: _kind, xpAward: _xpAward, ...event } = e
  return event
}

/**
 * Appends stamped events; an event whose reviewId is already stored stays as
 * it is (first write wins, roadmap contract). New rows start as kind `new`
 * with no award: the caller re-derives their words in the same transaction.
 * The three days are fixed by the stamp and never change.
 */
export async function insertEvents(tx: Queryable, userId: string, events: readonly StampedReviewEvent[]): Promise<void> {
  if (events.length === 0) return
  const rows = events.map((e) => ({
    review_id: e.reviewId,
    word_id: e.wordId,
    mode: e.mode,
    direction: e.direction,
    grade: e.grade,
    latency_ms: e.latencyMs,
    practice: e.practice,
    client_ts: e.clientTs,
    client_tz_offset_min: e.clientTzOffsetMin,
    device_id: e.deviceId,
    device_seq: e.deviceSeq,
    scheduler_version: e.schedulerVersion,
    received_at: e.receivedAt,
    effective_ts: e.effectiveTs,
    xp_eligible: e.xpEligible,
    // The date the learner saw when answering (spec §8.4), which day_complete is checked against.
    client_local_day: localDay(e.clientTs, e.clientTzOffsetMin),
    // classifyEvents' day and the XP cap's day.
    local_day: localDay(e.effectiveTs, e.clientTzOffsetMin),
    utc_day: utcDay(e.effectiveTs),
  }))
  await tx.query(
    `insert into review_event (user_id, review_id, word_id, mode, direction, grade, latency_ms, practice, client_ts,
       client_tz_offset_min, device_id, device_seq, scheduler_version, received_at, effective_ts, xp_eligible,
       client_local_day, local_day, utc_day)
     select $1, r.review_id, r.word_id, r.mode, r.direction, r.grade, r.latency_ms, r.practice, r.client_ts,
       r.client_tz_offset_min, r.device_id, r.device_seq, r.scheduler_version, r.received_at, r.effective_ts, r.xp_eligible,
       r.client_local_day, r.local_day, r.utc_day
     from jsonb_to_recordset($2::jsonb) as r(review_id text, word_id text, mode text, direction text, grade smallint,
       latency_ms integer, practice boolean, client_ts bigint, client_tz_offset_min smallint, device_id text,
       device_seq bigint, scheduler_version text, received_at bigint, effective_ts bigint, xp_eligible boolean,
       client_local_day integer, local_day integer, utc_day integer)
     on conflict (user_id, review_id) do nothing`,
    [userId, JSON.stringify(rows)],
  )
}

/** The learner's events: all of them, or those recorded under the given raw word IDs. */
export async function loadEvents(tx: Queryable, userId: string, wordIds?: readonly string[]): Promise<StoredEvent[]> {
  const rows =
    wordIds === undefined
      ? await tx.query<EventRow>(`select ${EVENT_COLUMNS} from review_event where user_id = $1`, [userId])
      : await tx.query<EventRow>(`select ${EVENT_COLUMNS} from review_event where user_id = $1 and word_id = any($2::text[])`, [
          userId,
          wordIds,
        ])
  return rows.map(toStoredEvent)
}
