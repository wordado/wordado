import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { corpusWordId, DEFAULT_SETTINGS, Grade, loadCorpus, themeEntries, validatePack, type CefrLevel, type Corpus, type WordFlag, type WordId } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import { appendAnswer, loadLearner, type AnswerInput, type Learner } from './learner'
import { ensureDevice } from './meta'
import { migrate } from './schema'
import { availableModes, dayCompleteInput, entryOf, newUnlocks, pathView, progressView, sessionPlan, type StudyContext } from './study'
import { openTrialClient, trialCorpus } from './testing/sample'
import { testEnv, type TestEnv } from './testing/testEnv'

const SAMPLE = fileURLToPath(new URL('../../pipeline/samples/a1/corpus-v0-bg.pack', import.meta.url))
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
    toLearn: new Map<WordId, number>(),
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

describe('sessionPlan in a trial (spec 2026-10-12 §4.4)', () => {
  it('starts new words only in the declared level\'s unit, yet reviews a word of another level when due', async () => {
    const { db, env, learner, ctx } = await setup()
    const trial = trialCorpus(['A1', 'A2', 'B1'])
    const [a1, , b1] = trial.units
    // A limit a course would fill by running on into the A2 and B1 units.
    const settings = { ...DEFAULT_SETTINGS, declaredLevel: 'A1' as const, newWordLimit: 50 }
    // A B1 word started earlier, at another level.
    const started = b1!.wordIds[0]!
    await appendAnswer(db, env, learner, answer(started))
    env.advance(10 * 86_400_000)
    const plan = sessionPlan(ctx({ corpus: trial, settings, now: env.now() }))
    expect([...plan.newWords].sort()).toEqual([...a1!.wordIds].sort())
    expect(plan.reviews).toContain(started)
  })

  describe('a trial with an open theme (#290)', () => {
    const open = async (declared: CefrLevel = 'B1') => {
      const { db, env, learner, ctx } = await setup()
      const client = await openTrialClient(['A1', 'A2', 'B1'], env, declared, { openTheme: 'daily-life' })
      const trial = client.snapshot.corpus!
      const unit = trial.units[0]!
      const themeWords = themeEntries(trial, 'daily-life').filter((e) => e.taught).map((e) => corpusWordId(e.entryId))
      const settings = (activeTheme: string | null) => ({ ...DEFAULT_SETTINGS, declaredLevel: declared, newWordLimit: 3, activeTheme })
      return { db, env, learner, ctx, trial, unit, themeWords, settings }
    }

    it('serves the open theme first when it is chosen', async () => {
      const { ctx, trial, unit, settings } = await open()
      const plan = sessionPlan(ctx({ corpus: trial, settings: settings('daily-life') }))
      expect(plan.newWords).toHaveLength(3)
      for (const wordId of plan.newWords) expect(entryOf(trial, wordId)!.themes).toContain('daily-life')
      // The theme sorts by level, so its first words are of a lower level than the unit's.
      expect(unit.wordIds).not.toContain(plan.newWords[0])
    })

    it('ignores another theme the settings name', async () => {
      const { ctx, trial, unit, settings } = await open()
      expect(sessionPlan(ctx({ corpus: trial, settings: settings('food') })).newWords).toEqual(unit.wordIds.slice(0, 3))
    })

    it('falls back to the unit once the chosen theme is all started', async () => {
      // The A2 unit holds words outside the theme; the B1 unit is wholly in it.
      const { db, env, learner, ctx, trial, unit, themeWords, settings } = await open('A2')
      for (const wordId of themeWords) {
        await appendAnswer(db, env, learner, answer(wordId))
        env.advance(5_000)
      }
      // Another day, or today's new-word limit would hold the unit back.
      env.advance(2 * 86_400_000)
      const plan = sessionPlan(ctx({ corpus: trial, settings: settings('daily-life') }))
      const unitLeft = unit.wordIds.filter((id) => !learner.states.has(id))
      expect(plan.newWords).toEqual(unitLeft.slice(0, 3))
      expect(plan.newWords.length).toBe(3)
    })

    it('counts the open theme in the progress tiers', async () => {
      const { db, env, learner, ctx, trial, unit, themeWords, settings } = await open()
      await appendAnswer(db, env, learner, answer(themeWords[0]!))
      const c = ctx({ corpus: trial, settings: settings('daily-life') })
      const view = progressView(c, sessionPlan(c))
      const extra = themeWords.filter((id) => !unit.wordIds.includes(id))
      expect(extra.length).toBeGreaterThan(0)
      expect(Object.values(view.tiers).reduce((a, b) => a + b, 0)).toBe(unit.wordIds.length + extra.length)
      expect([...view.units.keys()]).toEqual([unit.unitId])
      expect(Object.keys(view.levels)).toEqual(['B1'])
    })

    it('points to the unchosen open theme at the end', async () => {
      const { db, env, learner, ctx, trial, unit, settings } = await open()
      for (const wordId of unit.wordIds) {
        await appendAnswer(db, env, learner, answer(wordId))
        env.advance(5_000)
      }
      expect(pathView(ctx({ corpus: trial, settings: settings(null) }))).toMatchObject({ trialFinished: true, trialOpenTheme: 'daily-life' })
      expect(pathView(ctx({ corpus: trial, settings: settings('food') }))).toMatchObject({ trialFinished: true, trialOpenTheme: 'daily-life' })
      expect(pathView(ctx({ corpus: trial, settings: settings('daily-life') }))).toMatchObject({ trialFinished: false, trialOpenTheme: null })
    })
  })
})

/** The sample corpus with these words known from the start, as a later pack would mark them (issue #285). */
function withNotTaught(wordIds: readonly WordId[]): Corpus {
  const ids = new Set(wordIds)
  const entries = new Map([...corpus.entries].map(([key, e]) => [key, ids.has(`c:${key}` as WordId) ? { ...e, taught: false } : e]))
  return { ...corpus, entries, notTaught: ids }
}

describe('words that are never taught (issue #285)', () => {
  const firstUnit = () => corpus.units.find((u) => u.unitId === 'a1-01')!.wordIds

  it('never serves one as a new word, from the path, a theme or the words chosen to learn', async () => {
    const { ctx } = await setup()
    const quiet = withNotTaught(['c:hello-1', 'c:breakfast-1', 'c:lunch-1'])
    const settings = { ...DEFAULT_SETTINGS, newWordLimit: 3 }
    expect(sessionPlan(ctx({ corpus: quiet, settings })).newWords).toEqual(['c:goodbye-1', 'c:please-1', 'c:thank_you-1'])
    expect(sessionPlan(ctx({ corpus: quiet, settings: { ...settings, activeTheme: 'daily-life' } })).newWords).toEqual(['c:dinner-1', expect.any(String), expect.any(String)])
    const toLearn = new Map<WordId, number>([['c:lunch-1', 1]])
    expect(sessionPlan(ctx({ corpus: quiet, settings, toLearn })).newWords).not.toContain('c:lunch-1')
  })

  it('passes over a unit whose words are all never taught: the path starts at the next one', async () => {
    const { ctx } = await setup()
    const quiet = withNotTaught(firstUnit())
    const next = corpus.units.find((u) => u.unitId === 'a1-02')!.wordIds
    expect(sessionPlan(ctx({ corpus: quiet })).newWords).toEqual(next.slice(0, 10))
    expect(newUnlocks(ctx({ corpus: quiet }))).toEqual(['a1-01', 'a1-02'])
  })

  it('stops bringing up a word the learner started before it was no longer taught, and keeps its history', async () => {
    const { db, env, learner, ctx } = await setup()
    await learnUnit(db, env, learner, 'a1-01')
    env.advance(30 * 86_400_000)
    const due = sessionPlan(ctx({ now: env.now() }))
    expect(due.reviews).toContain('c:hello-1')
    const quiet = withNotTaught(['c:hello-1'])
    const plan = sessionPlan(ctx({ corpus: quiet, now: env.now() }))
    expect(plan.reviews).not.toContain('c:hello-1')
    expect(plan.backlogTotal).toBe(due.backlogTotal - 1)
    expect(learner.states.has('c:hello-1')).toBe(true)
    // Counted as known: out of the unit's live words and the tiers, as a word set aside is.
    const view = progressView(ctx({ corpus: quiet, now: env.now() }), plan)
    expect(view.units.get('a1-01')).toMatchObject({ live: 19, introduced: 19 })
    expect(view.levels['A1']).toMatchObject({ live: 59 })
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

  it('shows a trial the declared level\'s unit only, and a course every unit (spec 2026-10-12 §4.4)', async () => {
    const { db, env, learner, ctx } = await setup()
    const trial = trialCorpus(['A1', 'A2', 'B1'])
    const [a1, , b1] = trial.units
    // A word of another level's unit, started before the level changed: its reviews go on, its unit is not shown.
    await appendAnswer(db, env, learner, answer(a1!.wordIds[0]!))
    await appendAnswer(db, env, learner, answer(b1!.wordIds[0]!))
    const settings = { ...DEFAULT_SETTINGS, declaredLevel: 'B1' as const }
    const at = ctx({ corpus: trial, settings, now: env.now() })
    const view = progressView(at, sessionPlan(at))
    expect([...view.units.keys()]).toEqual([b1!.unitId])
    expect(Object.keys(view.levels)).toEqual(['B1'])
    expect(view.tiers).toEqual({ new: 19, learning: 1, young: 0, mature: 0 })

    const course = ctx({ corpus: { ...trial, trial: null }, settings, now: env.now() })
    const whole = progressView(course, sessionPlan(course))
    expect([...whole.units.keys()]).toEqual(trial.units.map((u) => u.unitId))
    expect(Object.keys(whole.levels).sort()).toEqual(['A1', 'A2', 'B1'])
    expect(Object.values(whole.tiers).reduce((a, b) => a + b, 0)).toBe(60)
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
