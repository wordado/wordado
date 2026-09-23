import {
  DOCUMENT_TYPES,
  isDue,
  isoDateToDay,
  localDay,
  RETENTION_TARGETS,
  settingsFromFields,
  streakStatus,
  type ReviewState,
  type StreakStatus,
} from '@wordado/core'
import type { Queryable } from '../db/db'
import type { ServerDeps } from '../deps'
import type { Reminder } from './text'

/** The cron runs every 15 minutes; a reminder is due in the run after its minute. Tuning (§15). */
export const REMINDER_WINDOW_MIN = 15
/** Reminders ignored in a row before they pause (spec §8.11). Tuning (§15). */
export const MAX_IGNORED_REMINDERS = 3
/** The evening streak nudge, local time. Tuning (§15). */
export const NUDGE_MINUTE = 20 * 60

const MINUTES_PER_DAY = 1440

export function localMinute(now: number, tzOffsetMin: number): number {
  return (((Math.floor(now / 60_000) + tzOffsetMin) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
}

/** Whether `minute` fell in the window ending now. */
export function inWindow(minute: number, nowMinute: number): boolean {
  return (nowMinute - minute + MINUTES_PER_DAY) % MINUTES_PER_DAY < REMINDER_WINDOW_MIN
}

async function streakOf(db: Queryable, userId: string, today: number): Promise<StreakStatus> {
  const rows = await db.query<{ local_date: string }>('select local_date from day_complete where user_id = $1', [userId])
  return streakStatus(
    rows.map((r) => isoDateToDay(r.local_date)),
    today,
  )
}

async function studiedOn(db: Queryable, userId: string, day: number): Promise<boolean> {
  const rows = await db.query('select 1 from review_event where user_id = $1 and client_local_day = $2 limit 1', [userId, day])
  return rows.length > 0
}

/**
 * What a reminder says now (spec §8.11): in the evening, if a streak needs
 * today, the streak; otherwise today's due count, without flagged words and
 * held to the learner's review cap (spec §7.4).
 */
export async function currentReminder(db: Queryable, userId: string, now: number, tzOffsetMin: number): Promise<Reminder> {
  const today = localDay(now, tzOffsetMin)
  if (localMinute(now, tzOffsetMin) >= NUDGE_MINUTE) {
    const streak = await streakOf(db, userId, today)
    if (streak.length > 0 && !streak.todayComplete) return { kind: 'streak', days: streak.length }
  }
  const [settingsRow] = await db.query<{ fields: Record<string, unknown> }>(
    `select fields from document where user_id = $1 and type = $2 and key = '' and not deleted`,
    [userId, DOCUMENT_TYPES.settings],
  )
  const settings = settingsFromFields(settingsRow?.fields ?? {})
  const flags = await db.query<{ key: string }>('select key from document where user_id = $1 and type = $2 and not deleted', [
    userId,
    DOCUMENT_TYPES.wordFlag,
  ])
  const flagged = new Set(flags.map((f) => f.key))
  const states = await db.query<{ state: ReviewState }>('select state from review_state where user_id = $1', [userId])
  const retention = RETENTION_TARGETS[settings.retention]
  const due = states.filter(({ state }) => !flagged.has(state.wordId) && isDue(state, retention, now, today)).length
  return { kind: 'due', count: Math.min(due, settings.reviewCap) }
}

interface SubscriptionRow {
  readonly endpoint: string
  readonly user_id: string
  readonly reminder_minute: number
  readonly tz_offset_min: number
  readonly streak_nudge: boolean
  readonly ignored: number
  readonly last_sent_at: number | null
  readonly last_reminder_day: number | null
  readonly last_nudge_day: number | null
}

/** One subscription whose daily reminder or nudge falls in this window. */
async function remind(deps: ServerDeps, row: SubscriptionRow, today: number, now: number, daily: boolean, nudge: boolean): Promise<'sent' | 'gone' | null> {
  const { db } = deps
  // Studying since the last reminder means it was not ignored.
  const studiedSince =
    row.last_sent_at !== null &&
    (await db.query('select 1 from review_event where user_id = $1 and received_at > $2 limit 1', [row.user_id, row.last_sent_at])).length > 0
  const ignored = studiedSince ? 0 : row.ignored
  let send = daily && !(await studiedOn(db, row.user_id, today))
  if (!send && nudge) {
    const streak = await streakOf(db, row.user_id, today)
    send = streak.length > 0 && !streak.todayComplete
  }
  const mark = `last_reminder_day = case when $3 then $4 else last_reminder_day end,
                last_nudge_day = case when $5 then $4 else last_nudge_day end`
  // Studied, paused or sent, the day is handled: it is not looked at again.
  if (!send || ignored >= MAX_IGNORED_REMINDERS) {
    await db.query(`update push_subscription set ignored = $2, ${mark} where endpoint = $1`, [row.endpoint, ignored, daily, today, nudge])
    return null
  }
  if ((await deps.push.send(row.endpoint)) === 'gone') {
    await db.query('delete from push_subscription where endpoint = $1', [row.endpoint])
    return 'gone'
  }
  await db.query(`update push_subscription set ignored = $2, last_sent_at = $6, ${mark} where endpoint = $1`, [
    row.endpoint,
    ignored + 1,
    daily,
    today,
    nudge,
    now,
  ])
  return 'sent'
}

/**
 * Sends the reminders due in this cron window (spec §8.11). Every
 * subscription is read and filtered here, which is fine for a beta's few
 * hundred; move the window test into SQL when that stops being true.
 */
export async function sendDueReminders(deps: ServerDeps): Promise<{ sent: number; gone: number; failed: number }> {
  const run = { sent: 0, gone: 0, failed: 0 }
  if (!deps.config.vapid) return run
  const now = deps.now()
  const rows = await deps.db.query<SubscriptionRow>(
    `select endpoint, user_id, reminder_minute, tz_offset_min, streak_nudge, ignored, last_sent_at, last_reminder_day, last_nudge_day
     from push_subscription`,
  )
  for (const row of rows) {
    const today = localDay(now, row.tz_offset_min)
    const minute = localMinute(now, row.tz_offset_min)
    const daily = inWindow(row.reminder_minute, minute) && row.last_reminder_day !== today
    const nudge = row.streak_nudge && inWindow(NUDGE_MINUTE, minute) && row.last_nudge_day !== today
    if (!daily && !nudge) continue
    try {
      const outcome = await remind(deps, row, today, now, daily, nudge)
      if (outcome) run[outcome] += 1
    } catch (error) {
      run.failed += 1
      console.error('reminder failed', row.endpoint, error)
    }
  }
  return run
}
