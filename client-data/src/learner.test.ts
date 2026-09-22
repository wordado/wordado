import { applyGrade, Grade, localDay, type DaySummary, type ReviewState } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import type { SqlDriver, SqlValue } from './driver'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import {
  allSummaries,
  appendAnswer,
  eventsAboveMarks,
  loadLearner,
  pendingDayComplete,
  provisionalXp,
  recordDayComplete,
  reloadLearner,
  replaceSnapshot,
  todayCounts,
  unpushedEvents,
  markEventsPushed,
  type AnswerInput,
} from './learner'
import { ensureDevice } from './meta'
import { migrate } from './schema'
import { testEnv, type TestEnv } from './testing/testEnv'

const HELLO = 'c:hello-1'
const WATER = 'c:water-1'
const answer = (wordId: string, over: Partial<AnswerInput> = {}): AnswerInput => ({
  wordId: wordId as AnswerInput['wordId'],
  mode: 'multiple_choice',
  direction: 'en_to_l1',
  grade: Grade.Good,
  latencyMs: 1500,
  practice: false,
  ...over,
})

async function open(env: TestEnv = testEnv()) {
  const db = new Database(nodeSqliteDriver())
  await migrate(db)
  const deviceId = await ensureDevice(db, env)
  const learner = await loadLearner(db, deviceId)
  return { db, env, learner }
}

describe('appendAnswer', () => {
  it('stores the event with the next device sequence and derives the state', async () => {
    const { db, env, learner } = await open()
    const first = await appendAnswer(db, env, learner, answer(HELLO))
    env.advance(60_000)
    const second = await appendAnswer(db, env, learner, answer(WATER, { mode: 'flashcard', grade: Grade.Easy }))
    expect([first.deviceSeq, second.deviceSeq]).toEqual([1, 2])
    expect(first).toMatchObject({ deviceId: learner.deviceId, clientTzOffsetMin: 120, schedulerVersion: expect.stringMatching(/^fsrs/) })
    expect(learner.states.get(HELLO)?.reps).toBe(1)
    expect(learner.states.get(WATER)?.lastGrade).toBe(Grade.Easy)
    expect(await unpushedEvents(db.driver)).toHaveLength(2)
    const reloaded = await loadLearner(db, learner.deviceId)
    expect(reloaded.states).toEqual(learner.states)
  })

  it('keeps an answer recorded while a reload was reading the log', async () => {
    const env = testEnv()
    const inner = nodeSqliteDriver()
    let release: () => void = () => {}
    const stalled = new Promise<void>((resolve) => {
      release = resolve
    })
    let stallNext = false
    // Runs the query, then holds the rows back: a pull's reload overlapping an answer.
    const driver: SqlDriver = {
      ...inner,
      all: async <T extends object>(sql: string, params: readonly SqlValue[] = []) => {
        const rows = await inner.all<T>(sql, params)
        if (stallNext && sql.includes('FROM review_event')) {
          stallNext = false
          await stalled
        }
        return rows
      },
    }
    const db = new Database(driver)
    await migrate(db)
    const learner = await loadLearner(db, await ensureDevice(db, env))
    stallNext = true
    const reload = reloadLearner(db, learner)
    await new Promise((r) => setTimeout(r, 5))
    const append = appendAnswer(db, env, learner, answer(WATER))
    await new Promise((r) => setTimeout(r, 5))
    release()
    await Promise.all([reload, append])
    expect(learner.localEvents).toHaveLength(1)
    expect(learner.states.get(WATER)?.reps).toBe(1)
  })

  it('takes a failed commit back out of memory', async () => {
    const { db, env, learner } = await open()
    await appendAnswer(db, env, learner, answer(HELLO))
    await db.exec('DROP TABLE review_event')
    await expect(appendAnswer(db, env, learner, answer(WATER))).rejects.toThrow()
    expect(learner.localEvents.map((e) => e.wordId)).toEqual([HELLO])
    expect(learner.states.has(WATER)).toBe(false)
  })

  it('logs practice and matching answers without touching the schedule', async () => {
    const { db, env, learner } = await open()
    await appendAnswer(db, env, learner, answer(HELLO, { practice: true }))
    await appendAnswer(db, env, learner, answer(WATER, { mode: 'matching', practice: true }))
    expect(learner.states.size).toBe(0)
    expect(learner.localEvents).toHaveLength(2)
  })

  it('refuses an impossible time-zone offset before anything is written', async () => {
    const env = testEnv(Date.UTC(2026, 0, 5, 10), 900)
    const { db, learner } = await open(env)
    await expect(appendAnswer(db, env, learner, answer(HELLO))).rejects.toThrow(/offset/)
    expect(learner.localEvents).toHaveLength(0)
    expect(await db.all('SELECT count(*) AS c FROM review_event')).toEqual([{ c: 0 }])
  })
})

describe('the server snapshot and the rebase rule', () => {
  it('replaces state with the server\'s and re-applies the events above its marks', async () => {
    const { db, env, learner } = await open()
    await appendAnswer(db, env, learner, answer(HELLO))
    env.advance(1000)
    await appendAnswer(db, env, learner, answer(WATER))
    await db.transaction((tx) => markEventsPushed(tx, learner.localEvents.map((e) => e.reviewId)))
    // The server has seen only the first event and derived a different (older) state for hello.
    const serverHello: ReviewState = applyGrade(null, HELLO, Grade.Hard, env.now() - 5000, 120)
    await db.transaction((tx) =>
      replaceSnapshot(tx, { states: [serverHello], marks: { [learner.deviceId]: 1 }, summaries: [], dayComplete: [] }),
    )
    await reloadLearner(db, learner)
    expect(learner.serverStates.get(HELLO)).toEqual(serverHello)
    expect(learner.states.get(HELLO)).toEqual(serverHello)
    expect(learner.states.get(WATER)?.reps).toBe(1)
    expect(learner.localEvents.map((e) => e.deviceSeq)).toEqual([2])
    expect(eventsAboveMarks(learner).map((e) => e.deviceSeq)).toEqual([2])
  })

  it('keeps unpushed events even when a mark would cover their sequence', async () => {
    const { db, env, learner } = await open()
    await appendAnswer(db, env, learner, answer(HELLO))
    await db.transaction((tx) => replaceSnapshot(tx, { states: [], marks: { [learner.deviceId]: 5 }, summaries: [], dayComplete: [] }))
    await reloadLearner(db, learner)
    expect(learner.localEvents).toHaveLength(1)
    expect(await unpushedEvents(db.driver)).toHaveLength(1)
  })
})

describe('today', () => {
  it('adds today\'s pulled summary to the local events above the marks', async () => {
    const { db, env, learner } = await open()
    const today = localDay(env.now(), 120)
    const pulled: DaySummary = { day: today, reviews: 4, successes: 3, newWords: 2, answered: 7, practice: 1 }
    await db.transaction((tx) => replaceSnapshot(tx, { states: [], marks: {}, summaries: [pulled], dayComplete: [] }))
    await reloadLearner(db, learner)
    await appendAnswer(db, env, learner, answer(HELLO))
    await appendAnswer(db, env, learner, answer(WATER, { practice: true }))
    expect(todayCounts(learner, today)).toEqual({ reviewsDone: 4, newWordsDone: 3, practiceDone: 2, answered: 9 })
    expect(allSummaries(learner).get(today)).toEqual({ day: today, reviews: 4, successes: 3, newWords: 3, answered: 9, practice: 2 })
  })

  it('records a completed day once and lists it for the push', async () => {
    const { db, env, learner } = await open()
    const today = localDay(env.now(), 120)
    expect(await recordDayComplete(db, learner, today, env.now())).toBe(true)
    expect(await recordDayComplete(db, learner, today, env.now())).toBe(false)
    expect([...learner.completeDays]).toEqual([today])
    expect(await pendingDayComplete(db.driver)).toEqual([{ localDate: '2026-01-05', ruleVersion: 'r1' }])
  })

  it('shows provisional XP for the events the server has not counted', async () => {
    const { db, env, learner } = await open()
    await appendAnswer(db, env, learner, answer(HELLO))
    await appendAnswer(db, env, learner, answer(WATER, { practice: true }))
    expect(provisionalXp(learner).total).toBe(12)
  })
})
