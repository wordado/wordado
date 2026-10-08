import { corpusWordId, DAY_MS, Grade, RELEARN_DELAY_MS, themeEntries, XP_AMOUNTS, type Mode, type WordId } from '@wordado/core'
import { describe, expect, it, vi } from 'vitest'
import { ITEM_SETTLE_MS, PRACTICE_RUN_SIZE, StudyRun, visitProgress, type RunOptions } from './run'
import { openSampleClient } from './testing/sample'
import { testEnv, type TestEnv } from './testing/testEnv'

const options = (over: Partial<RunOptions> = {}): RunOptions => ({
  kind: 'session',
  mode: null,
  cachedClips: () => new Set(),
  online: () => false,
  ...over,
})

/** Answers whatever is asked, correctly, until the run ends. Settles before every action, as a learner would. */
async function playThrough(run: StudyRun, env: TestEnv, grade: Grade = Grade.Good): Promise<void> {
  for (let guard = 0; guard < 200 && run.snapshot.phase !== 'done'; guard += 1) {
    const { phase, item } = run.snapshot
    if (!item) break
    env.advance(ITEM_SETTLE_MS)
    if (item.mode === 'flashcard') {
      if (phase === 'prompt') run.reveal()
      await run.rate(grade)
    } else if (phase === 'prompt') {
      await run.choose(grade === Grade.Again ? (item.answerIndex + 1) % item.options.length : item.answerIndex)
    } else {
      run.next()
    }
  }
}

describe('StudyRun', () => {
  it('serves the session plan in order, records each answer, and ends when nothing is due', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const planned = client.snapshot.plan!.newWords
    const run = await StudyRun.start(client, env, options())
    expect(run.snapshot).toMatchObject({ phase: 'prompt', remaining: 10, answered: 0 })
    expect(run.snapshot.item?.wordId).toBe(planned[0])
    await playThrough(run, env)
    expect(run.snapshot).toMatchObject({ phase: 'done', item: null, answered: 10, remaining: 0, dayCompleted: true })
    expect(run.snapshot.unlocked).toEqual(['a1-01'])
    expect(client.snapshot.progress?.tiers.new).toBe(50)
  })

  it('grades a choice from its latency, measured from when the prompt was presented', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'multiple_choice' }))
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    env.advance(20_000) // e.g. the audio of a listening item
    run.presented()
    env.advance(9_000) // slower than the 8 s threshold
    await run.choose(item.answerIndex)
    expect(run.snapshot.feedback).toEqual({ correct: true, chosen: item.answerIndex, grade: Grade.Hard })
    expect(client.snapshot.states.get(item.wordId)?.lastGrade).toBe(Grade.Hard)
  })

  it('records a wrong choice as Again and shows which option was chosen', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'multiple_choice' }))
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    const wrong = (item.answerIndex + 1) % item.options.length
    env.advance(ITEM_SETTLE_MS)
    await run.choose(wrong)
    expect(run.snapshot).toMatchObject({ phase: 'feedback', feedback: { correct: false, chosen: wrong, grade: Grade.Again } })
    // Again brings the word back after the relearn delay, not now: 9 are left.
    expect(run.snapshot.remaining).toBe(9)
    env.advance(ITEM_SETTLE_MS)
    run.next()
    expect(run.snapshot.phase).toBe('prompt')
    expect(run.snapshot.item?.wordId).not.toBe(item.wordId)
  })

  it('records one answer when the same choice arrives twice at once', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'multiple_choice' }))
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    env.advance(ITEM_SETTLE_MS)
    await Promise.all([run.choose(item.answerIndex), run.choose(item.answerIndex)])
    expect(run.snapshot.answered).toBe(1)
    expect(client.snapshot.states.get(item.wordId)?.reps).toBe(1)
  })

  it('passes a flashcard self-rating through, and only after the reveal', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    const item = run.snapshot.item!
    expect(item.mode).toBe('flashcard')
    await run.rate(Grade.Easy)
    expect(run.snapshot.answered).toBe(0)
    env.advance(ITEM_SETTLE_MS)
    run.reveal()
    expect(run.snapshot.phase).toBe('revealed')
    env.advance(ITEM_SETTLE_MS)
    await run.rate(Grade.Easy)
    expect(client.snapshot.states.get(item.wordId)?.lastGrade).toBe(Grade.Easy)
    expect(run.snapshot).toMatchObject({ phase: 'prompt', answered: 1 })
  })

  it('ends a run whose only word left is due in ten minutes, and serves it again after', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await client.updateSettings({ newWordLimit: 1 })
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    const wordId = run.snapshot.item!.wordId
    await playThrough(run, env, Grade.Again)
    expect(run.snapshot).toMatchObject({ phase: 'done', answered: 1 })
    env.advance(RELEARN_DELAY_MS)
    const again = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    expect(again.snapshot.item?.wordId).toBe(wordId)
  })

  it('records practice with practice = true and leaves the schedule alone', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await playThrough(await StudyRun.start(client, env, options()), env)
    const states = client.snapshot.states
    const run = await StudyRun.start(client, env, options({ kind: 'practice' }))
    expect(run.snapshot.remaining).toBe(PRACTICE_RUN_SIZE)
    await playThrough(run, env, Grade.Again)
    expect(run.snapshot).toMatchObject({ phase: 'done', answered: PRACTICE_RUN_SIZE })
    expect(client.snapshot.states).toEqual(states)
  })

  it('draws a unit’s practice only from that unit’s started words, and leaves the schedule alone', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await client.updateSettings({ newWordLimit: 30 })
    // The first unit's twenty words and five of the second's.
    for (const wordId of client.snapshot.plan!.newWords.slice(0, 25)) {
      await client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    }
    // An hour on: introduced today, not due, so practice may serve them.
    env.advance(3_600_000)
    const [first, second, third] = client.snapshot.corpus!.units
    const states = client.snapshot.states
    const seen: WordId[] = []
    const run = await StudyRun.start(client, env, options({ kind: 'practice', mode: 'flashcard', scope: { kind: 'unit', id: second!.unitId } }))
    expect(run.snapshot.remaining).toBe(5)
    for (let guard = 0; guard < 20 && run.snapshot.item; guard += 1) {
      seen.push(run.snapshot.item.wordId)
      env.advance(ITEM_SETTLE_MS)
      run.reveal()
      env.advance(ITEM_SETTLE_MS)
      await run.rate(Grade.Again)
    }
    expect(seen).toHaveLength(5)
    expect(seen.every((wordId) => second!.wordIds.includes(wordId) && states.has(wordId))).toBe(true)
    expect(client.snapshot.states).toEqual(states)
    // A larger unit still gives a run of the usual size; a unit with nothing started gives none.
    expect((await StudyRun.start(client, env, options({ kind: 'practice', scope: { kind: 'unit', id: first!.unitId } }))).snapshot.remaining).toBe(PRACTICE_RUN_SIZE)
    expect((await StudyRun.start(client, env, options({ kind: 'practice', scope: { kind: 'unit', id: third!.unitId } }))).snapshot.phase).toBe('done')
  })

  it('draws the practice of a skipped level’s unit from all its words, and an answer starts none of them (spec §7.2, §7.4)', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    // Three words of the first unit are started; then the learner declares A2, and the whole of A1 is skipped.
    for (const wordId of client.snapshot.plan!.newWords.slice(0, 3)) {
      await client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    }
    env.advance(3_600_000)
    await client.updateSettings({ declaredLevel: 'A2' })
    const [first, second] = client.snapshot.corpus!.units
    expect(client.snapshot.progress!.levels.A1).toEqual({ kind: 'skipped' })
    const before = client.snapshot
    expect(before.states.size).toBe(3)
    for (const unit of [first!, second!]) {
      const seen: WordId[] = []
      const run = await StudyRun.start(client, env, options({ kind: 'practice', scope: { kind: 'unit', id: unit.unitId } }))
      expect(run.snapshot.remaining).toBe(PRACTICE_RUN_SIZE)
      for (let guard = 0; guard < 40 && run.snapshot.item; guard += 1) {
        const { item, phase } = run.snapshot
        if (!seen.includes(item.wordId)) seen.push(item.wordId)
        env.advance(ITEM_SETTLE_MS)
        if (item.mode === 'flashcard') {
          run.reveal()
          env.advance(ITEM_SETTLE_MS)
          await run.rate(Grade.Again)
        } else if (phase === 'prompt') await run.choose(item.answerIndex)
        else run.next()
      }
      expect(run.snapshot).toMatchObject({ phase: 'done', answered: PRACTICE_RUN_SIZE, unlocked: [] })
      expect(seen).toHaveLength(PRACTICE_RUN_SIZE)
      expect(seen.every((wordId) => unit.wordIds.includes(wordId))).toBe(true)
      expect(seen.some((wordId) => !before.states.has(wordId))).toBe(true)
    }
    // Nothing was started or introduced, and the path, the plan and the figures stand as they were.
    const after = client.snapshot
    expect(after.states).toEqual(before.states)
    expect(after.plan).toEqual(before.plan)
    expect(after.path).toEqual(before.path)
    expect(after.progress!.levels).toEqual(before.progress!.levels)
    expect(after.progress!.units).toEqual(before.progress!.units)
    expect(after.progress!.tiers).toEqual(before.progress!.tiers)
    // Each answer is a practice event at the practice rate.
    expect(after.xp.total - before.xp.total).toBe(2 * PRACTICE_RUN_SIZE * XP_AMOUNTS.practice)
    // Practice over everything still keeps to the three started words.
    expect((await StudyRun.start(client, env, options({ kind: 'practice' }))).snapshot.remaining).toBe(3)
  })

  it('leaves a word set aside out of a skipped level’s unit, and sets an unstarted word aside from the run', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await client.updateSettings({ declaredLevel: 'A2' })
    const unit = client.snapshot.corpus!.units[0]!
    for (const wordId of unit.wordIds.slice(0, unit.wordIds.length - 2)) await client.setFlag(wordId, 'known')
    const run = await StudyRun.start(client, env, options({ kind: 'practice', mode: 'flashcard', scope: { kind: 'unit', id: unit.unitId } }))
    expect(run.snapshot.remaining).toBe(2)
    const wordId = run.snapshot.item!.wordId
    expect(unit.wordIds.slice(-2)).toContain(wordId)
    await run.setAside('suspended')
    expect(client.snapshot.flags.get(wordId)).toBe('suspended')
    expect(run.snapshot).toMatchObject({ setAside: 1, remaining: 1 })
    expect(client.snapshot.states.size).toBe(0)
  })

  it('marks the word on screen to learn after its answer, takes it back, and counts what the run added (spec §7.4)', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await client.updateSettings({ declaredLevel: 'A2' })
    const unit = client.snapshot.corpus!.units[0]!
    const run = await StudyRun.start(client, env, options({ kind: 'practice', mode: 'multiple_choice', scope: { kind: 'unit', id: unit.unitId } }))
    const first = run.snapshot.item!
    if (first.mode === 'flashcard') throw new Error('expected a choice item')
    env.advance(ITEM_SETTLE_MS)
    await run.choose((first.answerIndex + 1) % first.options.length)
    expect(run.snapshot.phase).toBe('feedback')
    await run.setLearn(true)
    expect(run.snapshot).toMatchObject({ phase: 'feedback', toLearn: 1, error: null })
    expect(client.snapshot.toLearn).toEqual([first.wordId])
    // The practice answer started nothing; the session will: the word is today's first new word.
    expect(client.snapshot.states.size).toBe(0)
    expect(client.snapshot.plan!.newWords).toEqual([first.wordId])
    expect(client.snapshot.progress!.levels.A1).toEqual({ kind: 'skipped' })
    await run.setLearn(false)
    expect(run.snapshot.toLearn).toBe(0)
    expect(client.snapshot.toLearn).toEqual([])
    await run.setLearn(true)
    env.advance(ITEM_SETTLE_MS)
    run.next()
    // The next word, chosen before it is answered.
    const second = run.snapshot.item!
    expect(second.wordId).not.toBe(first.wordId)
    env.advance(1_000)
    await run.setLearn(true)
    expect(run.snapshot.toLearn).toBe(2)
    run.finish()
    expect(run.snapshot).toMatchObject({ phase: 'done', toLearn: 2 })
    expect(client.snapshot.toLearn).toEqual([first.wordId, second.wordId])
    // With no word on screen there is nothing to mark.
    await run.setLearn(true)
    expect(run.snapshot.toLearn).toBe(2)
  })

  it('counts every marked word the run showed, whenever it was marked, and not one set aside or never shown', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await client.updateSettings({ declaredLevel: 'A2' })
    const [unit, other] = client.snapshot.corpus!.units
    // Marked beforehand (on the path): every word of this unit, and one of another.
    for (const wordId of [...unit!.wordIds, other!.wordIds[0]!]) await client.setToLearn(wordId, true)
    const run = await StudyRun.start(client, env, options({ kind: 'practice', mode: 'flashcard', scope: { kind: 'unit', id: unit!.unitId } }))
    expect(run.snapshot.toLearn).toBe(1)
    await run.setAside('suspended')
    expect(run.snapshot.toLearn).toBe(1)
    env.advance(ITEM_SETTLE_MS)
    run.reveal()
    env.advance(ITEM_SETTLE_MS)
    await run.rate(Grade.Good)
    expect(run.snapshot.toLearn).toBe(2)
    run.finish()
    // The word set aside lost its mark; the second and third words were shown and are still marked.
    expect(run.snapshot).toMatchObject({ phase: 'done', setAside: 1, toLearn: 2 })
  })

  it('never starts empty while the scope has started words: when all are due today, practice uses them and leaves the schedule alone', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    for (const wordId of client.snapshot.plan!.newWords.slice(0, 6)) {
      await client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    }
    // A month on, every started word is due: all six are in today's plan.
    env.advance(30 * DAY_MS)
    await client.startSession()
    const due = new Set(client.snapshot.plan!.reviews)
    expect(due.size).toBe(6)
    const states = client.snapshot.states
    const first = client.snapshot.corpus!.units[0]!
    for (const scope of [undefined, { kind: 'unit', id: first.unitId } as const]) {
      const run = await StudyRun.start(client, env, options({ kind: 'practice', mode: 'flashcard', ...(scope && { scope }) }))
      expect(run.snapshot.remaining).toBe(6)
      expect(due.has(run.snapshot.item!.wordId)).toBe(true)
      await playThrough(run, env, Grade.Again)
      expect(run.snapshot).toMatchObject({ phase: 'done', answered: 6 })
    }
    expect(client.snapshot.states).toEqual(states)
    expect(client.snapshot.plan!.reviews).toHaveLength(6)
  })

  it('draws a theme’s practice from all the theme’s words, started or not, and an answer starts none of them (spec §7.4, §8.9)', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const theme = themeEntries(client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId))
    const scope = { kind: 'theme', id: 'daily-life' } as const
    // Three words of the path and two of the theme are started; the theme was never chosen.
    for (const wordId of [...client.snapshot.plan!.newWords.slice(0, 3), ...theme.slice(-2)]) {
      await client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    }
    env.advance(3_600_000)
    const before = client.snapshot
    expect(theme.filter((wordId) => before.states.has(wordId))).toHaveLength(2)
    const seen: WordId[] = []
    // Two rounds, answered wrongly and rightly alike.
    for (const grade of [Grade.Again, Grade.Good]) {
      const run = await StudyRun.start(client, env, options({ kind: 'practice', scope }))
      expect(run.snapshot.remaining).toBe(PRACTICE_RUN_SIZE)
      for (let guard = 0; guard < 40 && run.snapshot.item; guard += 1) {
        const { item, phase } = run.snapshot
        if (!seen.includes(item.wordId)) seen.push(item.wordId)
        env.advance(ITEM_SETTLE_MS)
        if (item.mode === 'flashcard') {
          run.reveal()
          env.advance(ITEM_SETTLE_MS)
          await run.rate(grade)
        } else if (phase === 'prompt') await run.choose(grade === Grade.Again ? (item.answerIndex + 1) % item.options.length : item.answerIndex)
        else run.next()
      }
      expect(run.snapshot).toMatchObject({ phase: 'done', answered: PRACTICE_RUN_SIZE, unlocked: [] })
    }
    expect(seen).toHaveLength(2 * PRACTICE_RUN_SIZE)
    expect(seen.every((wordId) => theme.includes(wordId))).toBe(true)
    expect(seen.filter((wordId) => !before.states.has(wordId)).length).toBeGreaterThanOrEqual(2 * PRACTICE_RUN_SIZE - 2)
    // Nothing was started or introduced: the review states, the plan, the path and every figure stand as they were.
    const after = client.snapshot
    expect(after.states).toEqual(before.states)
    expect(after.plan).toEqual(before.plan)
    expect(after.path).toEqual(before.path)
    expect(after.progress!.levels).toEqual(before.progress!.levels)
    expect(after.progress!.units).toEqual(before.progress!.units)
    expect(after.progress!.tiers).toEqual(before.progress!.tiers)
    expect(after.toLearn).toEqual([])
    // Practising a theme does not choose it.
    expect(after.settings.activeTheme).toBeNull()
    // Each answer is a practice event at the practice rate.
    expect(after.xp.total - before.xp.total).toBe(2 * PRACTICE_RUN_SIZE * XP_AMOUNTS.practice)
    // A theme the corpus does not hold is practice over everything: the five started words.
    expect((await StudyRun.start(client, env, options({ kind: 'practice', scope: { kind: 'theme', id: 'nowhere' } }))).snapshot.remaining).toBe(5)
  })

  it('leaves a word set aside out of a theme’s practice, and sets an unstarted word aside from the run', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const theme = themeEntries(client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId))
    for (const wordId of theme.slice(2)) await client.setFlag(wordId, 'known')
    const run = await StudyRun.start(client, env, options({ kind: 'practice', mode: 'flashcard', scope: { kind: 'theme', id: 'daily-life' } }))
    expect(run.snapshot.remaining).toBe(2)
    const wordId = run.snapshot.item!.wordId
    expect(theme.slice(0, 2)).toContain(wordId)
    await run.setAside('suspended')
    expect(client.snapshot.flags.get(wordId)).toBe('suspended')
    expect(run.snapshot).toMatchObject({ setAside: 1, remaining: 1 })
    expect(client.snapshot.states.size).toBe(0)
  })

  it('marks an unstarted word of a theme to learn, and choosing the theme then serves it once, first (spec §7.4, §8.9)', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const theme = themeEntries(client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId))
    const run = await StudyRun.start(client, env, options({ kind: 'practice', mode: 'flashcard', scope: { kind: 'theme', id: 'daily-life' } }))
    // Not the theme's first word, so that the order tells the two sources apart.
    for (let guard = 0; guard < PRACTICE_RUN_SIZE && run.snapshot.item?.wordId === theme[0]; guard += 1) {
      env.advance(ITEM_SETTLE_MS)
      run.reveal()
      env.advance(ITEM_SETTLE_MS)
      await run.rate(Grade.Good)
    }
    const marked = run.snapshot.item!.wordId
    env.advance(ITEM_SETTLE_MS)
    run.reveal()
    await run.setLearn(true)
    run.finish()
    expect(run.snapshot).toMatchObject({ phase: 'done', toLearn: 1 })
    expect(client.snapshot.states.size).toBe(0)
    // On the path's own day the word is the first new one.
    expect(client.snapshot.plan!.newWords[0]).toBe(marked)
    await client.updateSettings({ activeTheme: 'daily-life' })
    const planned = client.snapshot.plan!.newWords
    // Chosen by the learner and by the theme: served once, and the day still has its ten new words, all the theme's.
    expect(planned).toHaveLength(10)
    expect(new Set(planned).size).toBe(10)
    expect(planned[0]).toBe(marked)
    expect(planned.slice(1)).toEqual(theme.filter((wordId) => wordId !== marked).slice(0, 9))
  })

  it('never queues a retired word, in practice over everything or kept to a unit or theme', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const theme = themeEntries(client.snapshot.corpus!, 'daily-life')
    const only = corpusWordId(theme[0]!.entryId)
    await client.answer({ wordId: only, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    env.advance(3_600_000)
    await client.startSession()
    // The one started word is retired by a later pack (spec §5.1); its review state stays.
    const snapshot = client.snapshot
    const corpus = snapshot.corpus!
    const entries = new Map(corpus.entries)
    entries.set(theme[0]!.entryId, { ...theme[0]!, retired: true })
    vi.spyOn(client, 'snapshot', 'get').mockReturnValue({ ...snapshot, corpus: { ...corpus, entries, retired: new Set([only]) } })
    vi.spyOn(client, 'startSession').mockResolvedValue([])
    const unit = corpus.units.find((u) => u.wordIds.includes(only))!
    for (const scope of [undefined, { kind: 'unit', id: unit.unitId } as const]) {
      const run = await StudyRun.start(client, env, options({ kind: 'practice', ...(scope && { scope }) }))
      expect(run.snapshot).toMatchObject({ phase: 'done', remaining: 0, item: null })
    }
    // The theme is practised whole, but never its retired word: three rounds show the other twenty-four.
    const seen = new Set<WordId>()
    for (let round = 0; round < 3; round += 1) {
      const run = await StudyRun.start(client, env, options({ kind: 'practice', mode: 'flashcard', scope: { kind: 'theme', id: 'daily-life' } }))
      for (let guard = 0; guard < 20 && run.snapshot.item; guard += 1) {
        seen.add(run.snapshot.item.wordId)
        env.advance(ITEM_SETTLE_MS)
        run.reveal()
        env.advance(ITEM_SETTLE_MS)
        await run.rate(Grade.Good)
      }
    }
    expect(seen.size).toBe(theme.length - 1)
    expect(seen.has(only)).toBe(false)
  })

  it('offers listening only through availableModes: never without audio', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const seen = new Set<Mode>()
    const run = await StudyRun.start(client, env, options({ mode: 'listening_select' }))
    for (let i = 0; i < 5 && run.snapshot.item; i += 1) {
      seen.add(run.snapshot.item.mode)
      run.finish()
    }
    expect(seen.has('listening_select')).toBe(false)
    const online = await StudyRun.start(client, env, options({ mode: 'listening_select', online: () => true }))
    expect(online.snapshot.item?.mode).toBe('listening_select')
  })

  it('stops early on finish, keeping what was answered', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    env.advance(ITEM_SETTLE_MS)
    run.reveal()
    env.advance(ITEM_SETTLE_MS)
    await run.rate(Grade.Good)
    run.finish()
    expect(run.snapshot).toMatchObject({ phase: 'done', item: null, answered: 1 })
  })

  it('stays finished when finish() lands while a flashcard rating is being saved', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    env.advance(ITEM_SETTLE_MS)
    run.reveal()
    env.advance(ITEM_SETTLE_MS)
    const pending = run.rate(Grade.Good)
    run.finish()
    await pending
    expect(run.snapshot).toMatchObject({ phase: 'done', item: null, answered: 1 })
  })

  it('stays finished when finish() lands while a choice is being saved', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'multiple_choice' }))
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    env.advance(ITEM_SETTLE_MS)
    const pending = run.choose(item.answerIndex)
    run.finish()
    await pending
    expect(run.snapshot).toMatchObject({ phase: 'done', item: null, answered: 1 })
  })

  it("measures a flashcard's latency from the prompt being shown, not from the reveal", async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    const spy = vi.spyOn(client, 'answer')
    env.advance(5_000)
    run.reveal()
    env.advance(1_000)
    await run.rate(Grade.Good)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ latencyMs: 6_000 }))
  })

  it('ignores a reveal on the next item at the same instant as the previous rating, and takes it once settled', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    const first = run.snapshot.item!.wordId
    env.advance(ITEM_SETTLE_MS)
    run.reveal()
    env.advance(ITEM_SETTLE_MS)
    await run.rate(Grade.Good)
    expect(run.snapshot.item!.wordId).not.toBe(first)
    // Same clock as the item just shown: a stray reveal (a held or double Enter) must not open it early.
    run.reveal()
    expect(run.snapshot.phase).toBe('prompt')
    env.advance(ITEM_SETTLE_MS)
    run.reveal()
    expect(run.snapshot.phase).toBe('revealed')
  })

  it('ignores a choice on the next item at the same instant as the previous answer, and takes it once settled', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'multiple_choice' }))
    const first = run.snapshot.item!
    if (first.mode === 'flashcard') throw new Error('expected a choice item')
    env.advance(ITEM_SETTLE_MS)
    await run.choose(first.answerIndex)
    env.advance(ITEM_SETTLE_MS)
    run.next()
    const second = run.snapshot.item!
    if (second.mode === 'flashcard') throw new Error('expected a choice item')
    expect(second.wordId).not.toBe(first.wordId)
    // Same clock as the new item: a double press (or a held key) must not answer it.
    await run.choose(second.answerIndex)
    expect(run.snapshot.answered).toBe(1)
    env.advance(ITEM_SETTLE_MS)
    await run.choose(second.answerIndex)
    expect(run.snapshot.answered).toBe(2)
  })

  it('excludes the report dialog from a flashcard’s latency and does not re-block answering once it closes', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    const spy = vi.spyOn(client, 'answer')
    env.advance(1_000)
    run.reveal()
    run.pause()
    env.advance(10_000) // the report dialog is open
    run.resume()
    env.advance(1_000)
    await run.rate(Grade.Good)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ latencyMs: 2_000 }))
  })
})

describe('runs follow the settings and the learner (spec §7.4, §11.1)', () => {
  it('grades a slow correct answer as Good when latency grading is off', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await client.updateSettings({ latencyGrading: false })
    const run = await StudyRun.start(client, env, options({ mode: 'multiple_choice' }))
    const item = run.snapshot.item!
    env.advance(60_000)
    await run.choose(item.mode === 'flashcard' ? 0 : item.answerIndex)
    expect(run.snapshot.feedback).toMatchObject({ correct: true, grade: Grade.Good })
  })

  it('still grades a slow correct answer as Hard by default', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'multiple_choice' }))
    const item = run.snapshot.item!
    env.advance(60_000)
    await run.choose(item.mode === 'flashcard' ? 0 : item.answerIndex)
    expect(run.snapshot.feedback).toMatchObject({ correct: true, grade: Grade.Hard })
  })

  it('sets the word on screen aside, records no answer for it, and moves on', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    const first = run.snapshot.item!.wordId
    await run.setAside('known')
    expect(client.snapshot.flags.get(first)).toBe('known')
    expect(client.snapshot.states.has(first)).toBe(false)
    expect(run.snapshot.item!.wordId).not.toBe(first)
    expect(run.snapshot).toMatchObject({ answered: 0, setAside: 1, phase: 'prompt' })
    expect(client.snapshot.plan!.newWords).not.toContain(first)
  })

  it('sets a practice word aside and drops it from the practice queue', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    for (const wordId of client.snapshot.plan!.newWords.slice(0, 3)) {
      await client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    }
    // An hour on: introduced today, not due, so practice may serve them.
    env.advance(3_600_000)
    const run = await StudyRun.start(client, env, options({ kind: 'practice', mode: 'flashcard' }))
    const first = run.snapshot.item!.wordId
    await run.setAside('suspended')
    expect(client.snapshot.flags.get(first)).toBe('suspended')
    expect(run.snapshot.item?.wordId ?? null).not.toBe(first)
  })

  it('ignores a rating that lands within the settle time of the reveal (a double tap on Show answer)', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    env.advance(2_000)
    run.reveal()
    await run.rate(Grade.Good)
    expect(run.snapshot).toMatchObject({ phase: 'revealed', answered: 0 })
    env.advance(ITEM_SETTLE_MS)
    await run.rate(Grade.Good)
    expect(run.snapshot.answered).toBe(1)
  })
})

describe('a visit’s practice of one unit or theme covers it before repeating (spec §7.4)', () => {
  const scope = { kind: 'theme', id: 'daily-life' } as const

  /** One flashcard round of the scope, answered to the end, or stopped once `stopAfter` words have been answered: the words it showed, in order. */
  async function round(client: Awaited<ReturnType<typeof openSampleClient>>, env: TestEnv, over: Partial<RunOptions> = {}, stopAfter = Infinity): Promise<WordId[]> {
    const run = await StudyRun.start(client, env, options({ kind: 'practice', mode: 'flashcard', scope, ...over }))
    const shown: WordId[] = []
    for (let guard = 0; guard < 40 && run.snapshot.item; guard += 1) {
      shown.push(run.snapshot.item.wordId)
      if (shown.length > stopAfter) {
        run.finish()
        break
      }
      env.advance(ITEM_SETTLE_MS)
      run.reveal()
      env.advance(ITEM_SETTLE_MS)
      await run.rate(Grade.Good)
    }
    return shown
  }

  it('goes through the whole theme across "Practise more" before any word comes twice, then starts over', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const theme = themeEntries(client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId))
    expect(theme).toHaveLength(25)
    expect(visitProgress(client, scope)).toEqual({ seen: 0, total: 25 })
    const first = await round(client, env)
    expect(new Set(first).size).toBe(PRACTICE_RUN_SIZE)
    expect(visitProgress(client, scope)).toEqual({ seen: 10, total: 25 })
    const second = await round(client, env)
    expect(second).toHaveLength(PRACTICE_RUN_SIZE)
    expect(second.some((wordId) => first.includes(wordId))).toBe(false)
    expect(visitProgress(client, scope)).toEqual({ seen: 20, total: 25 })
    // Five are left: they lead the third round, and words already shown fill it up to its usual size.
    const third = await round(client, env)
    expect(new Set(third).size).toBe(PRACTICE_RUN_SIZE)
    expect(third.slice(0, 5).some((wordId) => first.includes(wordId) || second.includes(wordId))).toBe(false)
    expect(third.slice(5).every((wordId) => first.includes(wordId) || second.includes(wordId))).toBe(true)
    expect(new Set([...first, ...second, ...third])).toEqual(new Set(theme))
    expect(visitProgress(client, scope)).toEqual({ seen: 25, total: 25 })
    // All shown: the next round starts over.
    const fourth = await round(client, env)
    expect(new Set(fourth).size).toBe(PRACTICE_RUN_SIZE)
    expect(visitProgress(client, scope)).toEqual({ seen: 10, total: 25 })
    // Forty practice answers, and no word started.
    expect(client.snapshot.states.size).toBe(0)
  })

  it('remembers only the words a run really showed, and one memory per scope shared by every way to practise it', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await client.updateSettings({ declaredLevel: 'A2' })
    const unit = client.snapshot.corpus!.units[0]!
    const unitScope = { kind: 'unit', id: unit.unitId } as const
    // Stopped with the third word on screen.
    const begun = await round(client, env, {}, 2)
    expect(begun).toHaveLength(3)
    expect(visitProgress(client, scope)).toEqual({ seen: 3, total: 25 })
    expect(visitProgress(client, unitScope)).toEqual({ seen: 0, total: unit.wordIds.length })
    // Another way to practise the same theme carries on from there.
    const mixed = await round(client, env, { mode: 'multiple_choice' }, 0)
    expect(begun).not.toContain(mixed[0])
    expect(visitProgress(client, scope)).toEqual({ seen: 4, total: 25 })
    const ofUnit = await round(client, env, { scope: unitScope })
    expect(ofUnit.every((wordId) => unit.wordIds.includes(wordId))).toBe(true)
    expect(visitProgress(client, unitScope)).toEqual({ seen: 10, total: unit.wordIds.length })
    expect(visitProgress(client, scope)).toEqual({ seen: 4, total: 25 })
    const more = await round(client, env, { scope: unitScope })
    expect(more.some((wordId) => ofUnit.includes(wordId))).toBe(false)
  })

  it('counts against what a run can draw now: today’s session words are left out, and a word set aside leaves the count', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await client.updateSettings({ activeTheme: 'daily-life' })
    // Ten of the theme's words are today's new words: practice keeps to the other fifteen.
    expect(visitProgress(client, scope)).toEqual({ seen: 0, total: 15 })
    const first = await round(client, env)
    const second = await round(client, env)
    expect(first.concat(second).some((wordId) => client.snapshot.plan!.newWords.includes(wordId))).toBe(false)
    expect(visitProgress(client, scope)).toEqual({ seen: 15, total: 15 })
    await client.setFlag(first[0]!, 'known')
    expect(visitProgress(client, scope)).toEqual({ seen: 14, total: 14 })
  })

  it('keeps no memory for practice over everything, nor for a theme the corpus does not hold', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    for (const wordId of client.snapshot.plan!.newWords) {
      await client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    }
    env.advance(3_600_000)
    const nowhere = { kind: 'theme', id: 'nowhere' } as const
    expect(visitProgress(client, undefined)).toBeNull()
    expect(visitProgress(client, nowhere)).toBeNull()
    expect(await round(client, env, { scope: nowhere })).toHaveLength(PRACTICE_RUN_SIZE)
    expect(visitProgress(client, nowhere)).toBeNull()
  })

  it('is gone with the app: a client opened anew has shown nothing', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await round(client, env)
    expect(visitProgress(client, scope)).toEqual({ seen: 10, total: 25 })
    const again = await openSampleClient(env)
    expect(visitProgress(again, scope)).toEqual({ seen: 0, total: 25 })
  })
})
