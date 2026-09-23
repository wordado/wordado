import {
  isoDateToDay,
  openPushWindow,
  stampEvents,
  utcDay,
  type DeviceCarry,
  type PushPage,
  type PushResponse,
  type PushWindow,
  type ReviewEvent,
  type StampCarry,
  type StampedReviewEvent,
  type WireDayComplete,
} from '@wordado/core'
import type { Queryable } from '../db/db'
import type { ServerDeps } from '../deps'
import { lockLearner } from '../learner'
import { rederiveWords } from './derive'
import { insertEvents } from './events'

interface OpenWindow {
  readonly window: PushWindow
  readonly carry: StampCarry
  /** False until the window is first saved. */
  readonly stored: boolean
}

/**
 * The push's window (spec §9.2 step 1): fixed when its first page arrives and
 * used by every page after it, with the stamping carry threaded between them.
 * A never-seen device's lower bound is the account's creation less a day,
 * which covers a carried-over demo (spec §8.6).
 */
async function pushWindow(tx: Queryable, userId: string, page: PushPage, serverNow: number): Promise<OpenWindow> {
  const [row] = await tx.query<{ clock_offset_ms: number; lower_bound: number; upper_bound: number; carry: Record<string, DeviceCarry> }>(
    'select clock_offset_ms, lower_bound, upper_bound, carry from push_window where user_id = $1 and device_id = $2 and push_id = $3',
    [userId, page.deviceId, page.pushId],
  )
  if (row) {
    return {
      window: { clockOffsetMs: row.clock_offset_ms, lowerBound: row.lower_bound, upperBound: row.upper_bound },
      carry: new Map(Object.entries(row.carry)),
      stored: true,
    }
  }
  const [mark] = await tx.query<{ device_seq: number; effective_ts: number }>(
    'select device_seq, effective_ts from device where user_id = $1 and device_id = $2',
    [userId, page.deviceId],
  )
  const [user] = await tx.query<{ created_at: Date }>('select "createdAt" as created_at from "user" where id = $1', [userId])
  const window = openPushWindow({
    clientNow: page.clientNow,
    serverNow,
    lastAccepted: mark ? { deviceSeq: mark.device_seq, effectiveTs: mark.effective_ts } : null,
    accountCreatedAt: user ? user.created_at.getTime() : serverNow,
  })
  return { window, carry: new Map(), stored: false }
}

/** Keeps the window for the next page, or drops it after the last (plan 4: expired after `lastPage`). */
async function saveWindow(tx: Queryable, userId: string, page: PushPage, open: OpenWindow, carry: StampCarry, serverNow: number): Promise<void> {
  if (page.lastPage) {
    if (open.stored) await tx.query('delete from push_window where user_id = $1 and device_id = $2 and push_id = $3', [userId, page.deviceId, page.pushId])
    return
  }
  await tx.query(
    `insert into push_window (user_id, device_id, push_id, clock_offset_ms, lower_bound, upper_bound, carry, opened_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     on conflict (user_id, device_id, push_id) do update set carry = excluded.carry`,
    [
      userId,
      page.deviceId,
      page.pushId,
      open.window.clockOffsetMs,
      open.window.lowerBound,
      open.window.upperBound,
      JSON.stringify(Object.fromEntries(carry)),
      serverNow,
    ],
  )
}

/** The page's events minus repeats within it and answers already stored: first write wins. */
async function freshEvents(tx: Queryable, userId: string, events: readonly ReviewEvent[]): Promise<ReviewEvent[]> {
  const unique = new Map<string, ReviewEvent>()
  for (const event of events) if (!unique.has(event.reviewId)) unique.set(event.reviewId, event)
  if (unique.size === 0) return []
  const stored = await tx.query<{ review_id: string }>(
    'select review_id from review_event where user_id = $1 and review_id = any($2::text[])',
    [userId, [...unique.keys()]],
  )
  for (const { review_id } of stored) unique.delete(review_id)
  return [...unique.values()]
}

/** The device row (spec §6.2) moves to the highest stamped (deviceSeq, effectiveTs), never back. */
async function advanceDeviceMark(tx: Queryable, userId: string, deviceId: string, events: readonly StampedReviewEvent[]): Promise<void> {
  let top: StampedReviewEvent | null = null
  for (const event of events) if (!top || event.deviceSeq > top.deviceSeq) top = event
  if (!top) return
  await tx.query(
    `insert into device (user_id, device_id, device_seq, effective_ts) values ($1, $2, $3, $4)
     on conflict (user_id, device_id) do update set device_seq = excluded.device_seq, effective_ts = excluded.effective_ts
     where excluded.device_seq > device.device_seq`,
    [userId, deviceId, top.deviceSeq, top.effectiveTs],
  )
}

/**
 * A completed day counts once the log holds an answer on that local date
 * (spec §8.4), dated as the learner saw it: the answer's clientTs with its
 * own offset. Accepted days never change.
 */
async function acceptDayComplete(tx: Queryable, userId: string, days: readonly WireDayComplete[], serverNow: number): Promise<void> {
  if (days.length === 0) return
  const rows = days.map((d) => ({ local_date: d.localDate, rule_version: d.ruleVersion, day: isoDateToDay(d.localDate) }))
  await tx.query(
    `insert into day_complete (user_id, local_date, rule_version, received_at)
     select $1, d.local_date, d.rule_version, $3
     from jsonb_to_recordset($2::jsonb) as d(local_date text, rule_version text, day integer)
     where exists (select 1 from review_event e where e.user_id = $1 and e.client_local_day = d.day)
     on conflict (user_id, local_date) do nothing`,
    [userId, JSON.stringify(rows), serverNow],
  )
}

/**
 * One push page (spec §9.2), in one transaction under the learner's lock:
 * the window, the stamp, the log, the device mark, the words' derivation,
 * and — on the last page, once every answer of the push is in — the
 * completed days. A retried page changes nothing: its answers are
 * duplicates, and completed days are a set.
 */
export async function handlePush(deps: ServerDeps, userId: string, page: PushPage): Promise<PushResponse> {
  const min = deps.config.minProtocolVersion
  if (page.protocolVersion < min) return { status: 'upgrade_required', minProtocolVersion: min }
  const serverNow = deps.now()
  return deps.db.transaction(async (tx) => {
    await lockLearner(tx, userId)
    const open = await pushWindow(tx, userId, page, serverNow)
    const fresh = await freshEvents(tx, userId, page.events)
    const { events, carry } = stampEvents(fresh, open.window, serverNow, open.carry)
    await insertEvents(tx, userId, events)
    await advanceDeviceMark(tx, userId, page.deviceId, events)
    await saveWindow(tx, userId, page, open, carry, serverNow)
    if (events.length > 0) {
      await rederiveWords(
        tx,
        userId,
        events.map((e) => e.wordId),
        events.map((e) => utcDay(e.effectiveTs)),
      )
    }
    if (page.lastPage) await acceptDayComplete(tx, userId, page.dayComplete, serverNow)
    return { status: 'ok', documents: [], rejected: [] }
  })
}
