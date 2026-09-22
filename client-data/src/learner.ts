import {
  classifyEvents,
  computeXp,
  DAY_COMPLETE_RULE_VERSION,
  dayCounts,
  dayToIsoDate,
  isAboveMark,
  isoDateToDay,
  isValidTzOffset,
  mergeSummaries,
  rebase,
  SCHEDULER_VERSION,
  summarizeDays,
  type AliasMap,
  type DayCounts,
  type DaySummary,
  type Direction,
  type Grade,
  type Mode,
  type ReviewEvent,
  type ReviewState,
  type WireDayComplete,
  type WordId,
  type XpResult,
} from '@wordado/core'
import type { Database } from './database'
import type { SqlDriver, SqlValue } from './driver'
import type { ClientEnv } from './env'
import { nextDeviceSeq } from './meta'

export interface LocalEvent extends ReviewEvent {
  readonly pushed: boolean
}

/**
 * Everything derived, in memory. `serverStates`, `marks`, `summaries` and the
 * pulled `completeDays` are what the last pull sent; `localEvents` is this
 * device's log; `states` is always `rebase(serverStates, marks, localEvents)`.
 */
export interface Learner {
  readonly deviceId: string
  serverStates: Map<WordId, ReviewState>
  marks: Map<string, number>
  localEvents: LocalEvent[]
  states: Map<WordId, ReviewState>
  summaries: Map<number, DaySummary>
  completeDays: Set<number>
  aliases: AliasMap
  tombstoned: ReadonlySet<WordId>
}

export interface LearnerOptions {
  readonly aliases?: AliasMap
  readonly tombstoned?: ReadonlySet<WordId>
}

interface EventRow {
  review_id: string
  word_id: string
  mode: string
  direction: string
  grade: number
  latency_ms: number
  practice: number
  client_ts: number
  client_tz_offset_min: number
  device_id: string
  device_seq: number
  scheduler_version: string
  pushed: number
}

function rowToEvent(row: EventRow): LocalEvent {
  return {
    reviewId: row.review_id,
    wordId: row.word_id as WordId,
    mode: row.mode as Mode,
    direction: row.direction as Direction,
    grade: row.grade as Grade,
    latencyMs: row.latency_ms,
    practice: row.practice === 1,
    clientTs: row.client_ts,
    clientTzOffsetMin: row.client_tz_offset_min,
    deviceId: row.device_id,
    deviceSeq: row.device_seq,
    schedulerVersion: row.scheduler_version,
    pushed: row.pushed === 1,
  }
}

/** An outbox event carries its clientTs as effectiveTs until the server stamps it (plan 2 contract). */
const asReplayEvent = (e: LocalEvent) => ({ ...e, effectiveTs: e.clientTs })

async function readEvents(driver: SqlDriver, where = '', params: readonly SqlValue[] = []): Promise<LocalEvent[]> {
  const rows = await driver.all<EventRow>(`SELECT * FROM review_event ${where} ORDER BY device_id, device_seq`, params)
  return rows.map(rowToEvent)
}

export async function loadLearner(db: Database, deviceId: string, options: LearnerOptions = {}): Promise<Learner> {
  const learner: Learner = {
    deviceId,
    serverStates: new Map(),
    marks: new Map(),
    localEvents: [],
    states: new Map(),
    summaries: new Map(),
    completeDays: new Set(),
    aliases: options.aliases ?? new Map(),
    tombstoned: options.tombstoned ?? new Set(),
  }
  await reloadLearner(db, learner)
  return learner
}

/** Re-reads every table into the learner, after a pull. */
export async function reloadLearner(db: Database, learner: Learner): Promise<void> {
  const states = await db.all<{ state: string }>('SELECT state FROM review_state')
  learner.serverStates = new Map(states.map((r) => JSON.parse(r.state) as ReviewState).map((s) => [s.wordId, s]))
  const marks = await db.all<{ device_id: string; device_seq: number }>('SELECT device_id, device_seq FROM device_mark')
  learner.marks = new Map(marks.map((m) => [m.device_id, m.device_seq]))
  learner.localEvents = await readEvents(db.driver)
  const summaries = await db.all<{ day: number; reviews: number; successes: number; new_words: number; answered: number; practice: number }>('SELECT * FROM day_summary')
  learner.summaries = new Map(
    summaries.map((s) => [s.day, { day: s.day, reviews: s.reviews, successes: s.successes, newWords: s.new_words, answered: s.answered, practice: s.practice }]),
  )
  const days = await db.all<{ local_date: string }>('SELECT local_date FROM day_complete')
  learner.completeDays = new Set(days.map((d) => isoDateToDay(d.local_date)))
  learner.states = deriveStates(learner)
}

/** The events the server's snapshot cannot contain (spec §4.3). */
export function eventsAboveMarks(learner: Learner): LocalEvent[] {
  return learner.localEvents.filter((e) => isAboveMark(e, learner.marks))
}

/** The rebase rule (spec §4.3): the server's state with this device's newer events on top. */
export function deriveStates(learner: Learner): Map<WordId, ReviewState> {
  return rebase(learner.serverStates, learner.marks, learner.localEvents.map(asReplayEvent), learner.aliases, learner.tombstoned)
}

function classifyLocal(learner: Learner) {
  return classifyEvents(eventsAboveMarks(learner).map(asReplayEvent), { aliases: learner.aliases, prior: learner.serverStates })
}

/** Today's counts after a pull: the pulled summary for today plus the local events above the marks (plan 2 contract). */
export function todayCounts(learner: Learner, today: number): DayCounts {
  const pulled = learner.summaries.get(today)
  const local = dayCounts(classifyLocal(learner), today)
  return {
    reviewsDone: (pulled?.reviews ?? 0) + local.reviewsDone,
    newWordsDone: (pulled?.newWords ?? 0) + local.newWordsDone,
    practiceDone: (pulled?.practice ?? 0) + local.practiceDone,
    answered: (pulled?.answered ?? 0) + local.answered,
  }
}

/** The pulled summary plus the days recorded since, for the retention rate (plan 2 contract). */
export function allSummaries(learner: Learner): Map<number, DaySummary> {
  return mergeSummaries(learner.summaries.values(), summarizeDays(classifyLocal(learner)).values())
}

/** XP for the events the server has not counted yet: provisional, may exceed the cap until the next pull (spec §8.7). */
export function provisionalXp(learner: Learner): XpResult {
  return computeXp(eventsAboveMarks(learner).map(asReplayEvent), { aliases: learner.aliases, prior: learner.serverStates })
}

export interface AnswerInput {
  readonly wordId: WordId
  readonly mode: Mode
  readonly direction: Direction
  readonly grade: Grade
  readonly latencyMs: number
  readonly practice: boolean
}

/**
 * Records one answer (spec §6.2, §9.2): the event is appended with the next
 * device sequence in one transaction, and the derived state is recomputed.
 */
export async function appendAnswer(db: Database, env: ClientEnv, learner: Learner, input: AnswerInput): Promise<ReviewEvent> {
  const tz = env.tzOffsetMin()
  if (!isValidTzOffset(tz)) throw new Error(`Impossible time-zone offset ${tz}`)
  const event = await db.transaction(async (tx) => {
    const deviceSeq = await nextDeviceSeq(tx)
    const e: ReviewEvent = {
      reviewId: env.uuid(),
      ...input,
      clientTs: env.now(),
      clientTzOffsetMin: tz,
      deviceId: learner.deviceId,
      deviceSeq,
      schedulerVersion: SCHEDULER_VERSION,
    }
    await tx.run(
      `INSERT INTO review_event (review_id, word_id, mode, direction, grade, latency_ms, practice, client_ts, client_tz_offset_min, device_id, device_seq, scheduler_version, pushed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [e.reviewId, e.wordId, e.mode, e.direction, e.grade, e.latencyMs, e.practice ? 1 : 0, e.clientTs, e.clientTzOffsetMin, e.deviceId, e.deviceSeq, e.schedulerVersion],
    )
    return e
  })
  learner.localEvents.push({ ...event, pushed: false })
  learner.states = deriveStates(learner)
  return event
}

/** Records the completed day once (spec §8.4). False when it was already recorded. */
export async function recordDayComplete(db: Database, learner: Learner, day: number, now: number): Promise<boolean> {
  if (learner.completeDays.has(day)) return false
  await db.transaction((tx) =>
    tx.run('INSERT OR IGNORE INTO day_complete (local_date, rule_version, client_ts, pushed) VALUES (?, ?, ?, 0)', [dayToIsoDate(day), DAY_COMPLETE_RULE_VERSION, now]),
  )
  learner.completeDays.add(day)
  return true
}

export async function unpushedEvents(driver: SqlDriver): Promise<LocalEvent[]> {
  return readEvents(driver, 'WHERE pushed = 0')
}

export async function markEventsPushed(tx: SqlDriver, reviewIds: readonly string[]): Promise<void> {
  for (const id of reviewIds) await tx.run('UPDATE review_event SET pushed = 1 WHERE review_id = ?', [id])
}

export async function pendingDayComplete(driver: SqlDriver): Promise<WireDayComplete[]> {
  const rows = await driver.all<{ local_date: string; rule_version: string }>('SELECT local_date, rule_version FROM day_complete WHERE pushed = 0 ORDER BY local_date')
  return rows.map((r) => ({ localDate: r.local_date, ruleVersion: r.rule_version }))
}

export async function markDayCompletePushed(tx: SqlDriver, dates: readonly string[]): Promise<void> {
  for (const date of dates) await tx.run('UPDATE day_complete SET pushed = 1 WHERE local_date = ?', [date])
}

export interface SnapshotInput {
  readonly states: readonly ReviewState[]
  readonly marks: Readonly<Record<string, number>>
  readonly summaries: readonly DaySummary[]
  /** YYYY-MM-DD. */
  readonly dayComplete: readonly string[]
}

/**
 * Stores what a pull sent (spec §9.2): the whole derived state, the marks,
 * the summary and the completed dates. Pushed events the marks cover are
 * dropped; unpushed ones are kept whatever the marks say.
 */
export async function replaceSnapshot(tx: SqlDriver, input: SnapshotInput): Promise<void> {
  await tx.run('DELETE FROM review_state')
  for (const s of input.states) await tx.run('INSERT INTO review_state (word_id, state) VALUES (?, ?)', [s.wordId, JSON.stringify(s)])
  await tx.run('DELETE FROM device_mark')
  for (const [deviceId, seq] of Object.entries(input.marks)) {
    await tx.run('INSERT INTO device_mark (device_id, device_seq) VALUES (?, ?)', [deviceId, seq])
    await tx.run('DELETE FROM review_event WHERE device_id = ? AND device_seq <= ? AND pushed = 1', [deviceId, seq])
  }
  await tx.run('DELETE FROM day_summary')
  for (const s of input.summaries) {
    await tx.run('INSERT INTO day_summary (day, reviews, successes, new_words, answered, practice) VALUES (?, ?, ?, ?, ?, ?)', [s.day, s.reviews, s.successes, s.newWords, s.answered, s.practice])
  }
  for (const date of input.dayComplete) {
    await tx.run('INSERT INTO day_complete (local_date, rule_version, client_ts, pushed) VALUES (?, ?, 0, 1) ON CONFLICT (local_date) DO UPDATE SET pushed = 1', [date, DAY_COMPLETE_RULE_VERSION])
  }
}
