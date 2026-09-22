import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS, Grade, loadCorpus, validatePack, type Corpus, type WordFlag, type WordId } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import { appendAnswer, loadLearner, type AnswerInput, type Learner } from './learner'
import { ensureDevice } from './meta'
import { migrate } from './schema'
import { availableModes, dayCompleteInput, newUnlocks, progressView, sessionPlan, type StudyContext } from './study'
import { testEnv, type TestEnv } from './testing/testEnv'

const SAMPLE = fileURLToPath(new URL('../../pipeline/samples/a1-bg/corpus-v0-bg.pack', import.meta.url))
const parsed = validatePack(JSON.parse(readFileSync(SAMPLE, 'utf8')))
const corpus: Corpus = loadCorpus([parsed.status === 'ok' ? parsed.pack : (() => { throw new Error('sample invalid') })()])

const answer = (wordId: WordId, over: Partial<AnswerInput> = {}): AnswerInput => ({
  wordId, mode: 'multiple_choice', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 1500, practice: false, ...over,
})

async function setup(env: TestEnv = testEnv()) {
  const db = new Database(nodeSqliteDriver())
  await migrate(db)
  const learner = await loadLearner(db, await ensureDevice(db, env))
  const ctx = (over: Partial<StudyContext> = {}): StudyContext => ({
    corpus,
    learner,
    settings: DEFAULT_SETTINGS,
    flags: new Map<WordId, WordFlag>(),
    unlocked: new Set<string>(),
    now: env.now(),
    tzOffsetMin: env.tzOffsetMin(),
    ...over,
  })
  return { db, env, learner, ctx }
}

async function learnUnit(db: Database, env: TestEnv, learner: Learner, unitId: string): Promise<void> {
  for (const wordId of corpus.units.find((u) => u.unitId === unitId)!.wordIds) {
    await appendAnswer(db, env, learner, answer(wordId))
    env.advance(5_000)
  }
}

describe('sessionPlan', () => {
  it('starts a fresh learner on the first unit with the default new-word limit', async () => {
    const { ctx } = await setup()
    const plan = sessionPlan(ctx())
    expect(plan.reviews).toEqual([])
    expect(plan.newWords).toHaveLength(10)
    expect(plan.newWords[0]).toBe('c:hello-1')
    expect(plan.backlogTotal).toBe(0)
    expect(plan.newWordsPaused).toBe(false)
  })

  it('honours settings, flags and an active theme', async () => {
    const { ctx } = await setup()
    const flagged = new Map<WordId, WordFlag>([['c:hello-1', 'known']])
    const plan = sessionPlan(ctx({ settings: { ...DEFAULT_SETTINGS, newWordLimit: 3 }, flags: flagged }))
    expect(plan.newWords).toEqual(['c:goodbye-1', 'c:please-1', 'c:thank_you-1'])
    const themed = sessionPlan(ctx({ settings: { ...DEFAULT_SETTINGS, newWordLimit: 3, activeTheme: 'daily-life' } }))
    expect(themed.newWords).toEqual(['c:breakfast-1', 'c:lunch-1', 'c:dinner-1'])
  })

  it('counts today\'s work so the limit and the cap hold across calls', async () => {
    const { db, env, learner, ctx } = await setup()
    for (const wordId of sessionPlan(ctx()).newWords.slice(0, 4)) await appendAnswer(db, env, learner, answer(wordId))
    const plan = sessionPlan(ctx({ now: env.now() }))
    expect(plan.newWords).toHaveLength(6)
    expect(plan.newWords).not.toContain('c:hello-1')
  })

  it('unlocks the next unit once every live word of the current one is introduced', async () => {
    const { db, env, learner, ctx } = await setup()
    expect(newUnlocks(ctx())).toEqual(['a1-01'])
    await learnUnit(db, env, learner, 'a1-01')
    expect(newUnlocks(ctx({ now: env.now() }))).toEqual(['a1-01', 'a1-02'])
    expect(newUnlocks(ctx({ now: env.now(), unlocked: new Set(['a1-01', 'a1-02']) }))).toEqual([])
  })
})

describe('dayCompleteInput and progressView', () => {
  it('reports the day complete after one answer when nothing is due', async () => {
    const { db, env, learner, ctx } = await setup()
    const before = dayCompleteInput(ctx(), sessionPlan(ctx()))
    expect(before).toEqual({ backlogTotal: 0, reviewCap: 100, reviewsDoneToday: 0, answeredToday: 0, dailyGoal: null })
    await appendAnswer(db, env, learner, answer('c:hello-1'))
    expect(dayCompleteInput(ctx(), sessionPlan(ctx())).answeredToday).toBe(1)
  })

  it('counts tiers over live entries, levels, units, retention and the streak', async () => {
    const { db, env, learner, ctx } = await setup()
    await learnUnit(db, env, learner, 'a1-01')
    const flagged = new Map<WordId, WordFlag>([['c:water-1', 'known']])
    const view = progressView(ctx({ now: env.now(), flags: flagged }), sessionPlan(ctx({ now: env.now(), flags: flagged })))
    expect(view.tiers).toEqual({ new: 39, learning: 20, young: 0, mature: 0 })
    expect(view.levels['A1']).toEqual({ kind: 'progress', live: 59, mature: 0, share: 0 })
    expect(view.units.get('a1-01')).toMatchObject({ live: 20, introduced: 20, complete: false })
    expect(view.retention).toBeNull()
    expect(view.streak).toEqual({ length: 0, todayComplete: false, freezesLeft: 2 })
    expect(view.xpProvisional).toBe(200)
    expect(view.dueToday).toBe(0)
  })
})

describe('availableModes', () => {
  it('offers listening only with a clip at hand and audio on', async () => {
    const { ctx } = await setup()
    const none = new Set<string>()
    expect([...availableModes(ctx(), 'c:hello-1', none, false)]).toEqual(['flashcard', 'multiple_choice'])
    expect([...availableModes(ctx(), 'c:hello-1', none, true)]).toEqual(['flashcard', 'multiple_choice', 'listening_select'])
    expect([...availableModes(ctx(), 'c:hello-1', new Set(['hello-1-uk']), false)]).toContain('listening_select')
    const muted = ctx({ settings: { ...DEFAULT_SETTINGS, audio: false } })
    expect([...availableModes(muted, 'c:hello-1', new Set(['hello-1-uk']), true)]).toEqual(['flashcard', 'multiple_choice'])
    expect([...availableModes(ctx(), 'u:nope', none, true)]).toEqual(['flashcard', 'multiple_choice'])
  })
})
