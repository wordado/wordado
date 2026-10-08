import { corpusWordId, DAY_MS, Grade, RELEARN_DELAY_MS, themeEntries, XP_AMOUNTS, type Mode, type WordId } from '@wordado/core'
import { describe, expect, it, vi } from 'vitest'
import { ITEM_SETTLE_MS, PRACTICE_RUN_SIZE, StudyRun, type RunOptions } from './run'
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
    // Practice over everything, and a theme's, still keep to the three started words.
    expect((await StudyRun.start(client, env, options({ kind: 'practice' }))).snapshot.remaining).toBe(3)
    const theme = (await StudyRun.start(client, env, options({ kind: 'practice', scope: { kind: 'theme', id: 'daily-life' } }))).snapshot.remaining
    expect(theme).toBe(themeEntries(client.snapshot.corpus!, 'daily-life').filter((e) => before.states.has(corpusWordId(e.entryId))).length)
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

  it('draws a theme’s practice only from that theme’s started words, without choosing the theme', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const theme = themeEntries(client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId))
    // Ten words of the path and six of the theme, as a chosen theme would have brought forward (spec §8.9).
    for (const wordId of [...client.snapshot.plan!.newWords, ...theme.slice(-6)]) {
      await client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    }
    env.advance(3_600_000)
    const states = client.snapshot.states
    const started = theme.filter((wordId) => states.has(wordId))
    expect(started.length).toBeGreaterThanOrEqual(6)
    expect(started.length).toBeLessThan(states.size)
    const run = await StudyRun.start(client, env, options({ kind: 'practice', mode: 'flashcard', scope: { kind: 'theme', id: 'daily-life' } }))
    expect(run.snapshot.remaining).toBe(Math.min(started.length, PRACTICE_RUN_SIZE))
    const seen: WordId[] = []
    for (let guard = 0; guard < 20 && run.snapshot.item; guard += 1) {
      seen.push(run.snapshot.item.wordId)
      env.advance(ITEM_SETTLE_MS)
      run.reveal()
      env.advance(ITEM_SETTLE_MS)
      await run.rate(Grade.Good)
    }
    expect(seen.every((wordId) => started.includes(wordId))).toBe(true)
    expect(client.snapshot.states).toEqual(states)
    expect(client.snapshot.settings.activeTheme).toBeNull()
    // A theme the corpus does not hold is practice over everything.
    expect((await StudyRun.start(client, env, options({ kind: 'practice', scope: { kind: 'theme', id: 'nowhere' } }))).snapshot.remaining).toBe(PRACTICE_RUN_SIZE)
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
    for (const scope of [undefined, { kind: 'theme', id: 'daily-life' } as const, { kind: 'unit', id: unit.unitId } as const]) {
      const run = await StudyRun.start(client, env, options({ kind: 'practice', ...(scope && { scope }) }))
      expect(run.snapshot).toMatchObject({ phase: 'done', remaining: 0, item: null })
    }
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
