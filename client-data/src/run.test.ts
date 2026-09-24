import { Grade, RELEARN_DELAY_MS, type Mode } from '@wordado/core'
import { describe, expect, it, vi } from 'vitest'
import { PRACTICE_RUN_SIZE, StudyRun, type RunOptions } from './run'
import { openSampleClient } from './testing/sample'
import { testEnv } from './testing/testEnv'

const options = (over: Partial<RunOptions> = {}): RunOptions => ({
  kind: 'session',
  mode: null,
  cachedClips: () => new Set(),
  online: () => false,
  ...over,
})

/** Answers whatever is asked, correctly, until the run ends. */
async function playThrough(run: StudyRun, grade: Grade = Grade.Good): Promise<void> {
  for (let guard = 0; guard < 200 && run.snapshot.phase !== 'done'; guard += 1) {
    const { phase, item } = run.snapshot
    if (!item) break
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
    await playThrough(run)
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
    await run.choose(wrong)
    expect(run.snapshot).toMatchObject({ phase: 'feedback', feedback: { correct: false, chosen: wrong, grade: Grade.Again } })
    // Again brings the word back after the relearn delay, not now: 9 are left.
    expect(run.snapshot.remaining).toBe(9)
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
    run.reveal()
    expect(run.snapshot.phase).toBe('revealed')
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
    await playThrough(run, Grade.Again)
    expect(run.snapshot).toMatchObject({ phase: 'done', answered: 1 })
    env.advance(RELEARN_DELAY_MS)
    const again = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    expect(again.snapshot.item?.wordId).toBe(wordId)
  })

  it('records practice with practice = true and leaves the schedule alone', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await playThrough(await StudyRun.start(client, env, options()))
    const states = client.snapshot.states
    const run = await StudyRun.start(client, env, options({ kind: 'practice' }))
    expect(run.snapshot.remaining).toBe(PRACTICE_RUN_SIZE)
    await playThrough(run, Grade.Again)
    expect(run.snapshot).toMatchObject({ phase: 'done', answered: PRACTICE_RUN_SIZE })
    expect(client.snapshot.states).toEqual(states)
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
    run.reveal()
    await run.rate(Grade.Good)
    run.finish()
    expect(run.snapshot).toMatchObject({ phase: 'done', item: null, answered: 1 })
  })

  it('stays finished when finish() lands while a flashcard rating is being saved', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    run.reveal()
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
})
