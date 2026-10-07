import { corpusWordId, Grade, MATCHING_PAIRS } from '@wordado/core'
import { describe, expect, it, vi } from 'vitest'
import { MatchingRun } from './matching'
import { openSampleClient } from './testing/sample'
import { testEnv } from './testing/testEnv'

async function clientWithWords(count: number) {
  const env = testEnv()
  const client = await openSampleClient(env)
  for (const wordId of client.snapshot.plan!.newWords.slice(0, count)) {
    await client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2000, practice: false })
    env.advance(3_000)
  }
  return { env, client }
}

describe('MatchingRun', () => {
  it('needs five introduced words', async () => {
    const { env, client } = await clientWithWords(MATCHING_PAIRS - 1)
    expect(MatchingRun.start(client, env)).toBeNull()
  })

  it('needs five introduced words of the unit when practising one unit, and deals only that unit’s words', async () => {
    const { env, client } = await clientWithWords(10)
    await client.updateSettings({ newWordLimit: 30 })
    for (const wordId of client.snapshot.plan!.newWords.slice(0, 14)) {
      await client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2000, practice: false })
    }
    // Twenty words of the first unit are started, and four of the second.
    const [first, second] = client.snapshot.corpus!.units
    expect(MatchingRun.start(client, env, second!.unitId)).toBeNull()
    const run = MatchingRun.start(client, env, first!.unitId)!
    expect(run.snapshot.left).toHaveLength(MATCHING_PAIRS)
    expect(run.snapshot.left.every((e) => first!.wordIds.includes(corpusWordId(e.entryId)))).toBe(true)
    await client.answer({ wordId: client.snapshot.plan!.newWords[0]!, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2000, practice: false })
    expect(MatchingRun.start(client, env, second!.unitId)!.snapshot.left.every((e) => second!.wordIds.includes(corpusWordId(e.entryId)))).toBe(true)
  })

  it('matches pairs from either side, records each as practice, and grades a missed pair Again', async () => {
    const { env, client } = await clientWithWords(MATCHING_PAIRS)
    const states = client.snapshot.states
    const run = MatchingRun.start(client, env)!
    const spy = vi.spyOn(client, 'answer')
    const { left, right } = run.snapshot
    expect(left).toHaveLength(MATCHING_PAIRS)
    expect(new Set(right)).toEqual(new Set(left))
    const [a, b, c] = [left[0]!.entryId, left[1]!.entryId, left[2]!.entryId]

    await run.select('left', a)
    await run.select('right', b)
    expect(run.snapshot).toMatchObject({ selected: null, miss: { left: a, right: b } })
    expect(run.snapshot.matched.size).toBe(0)
    expect(spy).not.toHaveBeenCalled()

    await run.select('right', a)
    await run.select('left', a)
    expect(run.snapshot.matched).toEqual(new Set([a]))
    expect(run.snapshot.miss).toBeNull()
    // a came from a wrong pairing first: it grades Again.
    expect(spy).toHaveBeenLastCalledWith({
      wordId: corpusWordId(a),
      mode: 'matching',
      direction: 'en_to_l1',
      grade: Grade.Again,
      latencyMs: expect.any(Number),
      practice: true,
    })

    await run.select('left', c)
    await run.select('right', c)
    // c was never part of a miss: it grades Good.
    expect(spy).toHaveBeenLastCalledWith({
      wordId: corpusWordId(c),
      mode: 'matching',
      direction: 'en_to_l1',
      grade: Grade.Good,
      latencyMs: expect.any(Number),
      practice: true,
    })

    for (const entry of left.slice(1)) {
      await run.select('left', entry.entryId)
      await run.select('right', entry.entryId)
    }
    expect(run.snapshot.done).toBe(true)
    // Practice never touches the schedule (spec §7.4).
    expect(client.snapshot.states).toEqual(states)
    expect(spy.mock.calls.every(([input]) => input.mode === 'matching' && input.practice === true)).toBe(true)
  })

  it('keeps a pairing clicked while the previous one is still saving, not lost (a fast learner, or automation)', async () => {
    const { env, client } = await clientWithWords(MATCHING_PAIRS)
    const run = MatchingRun.start(client, env)!
    const [a, b] = run.snapshot.left.map((e) => e.entryId)
    const realAnswer = client.answer.bind(client)
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // The first grading write (pair a) is slow, as a real write can be under load; the UI's
    // onClick never awaits `select`, so a learner (or e2e automation) can select pair b before
    // it settles.
    vi.spyOn(client, 'answer').mockImplementationOnce(async (input) => {
      await gate
      return realAnswer(input)
    })

    await run.select('left', a!)
    const pairA = run.select('right', a!)
    const pairBLeft = run.select('left', b!)
    const pairBRight = run.select('right', b!)
    release!()
    await Promise.all([pairA, pairBLeft, pairBRight])

    expect(run.snapshot.matched).toEqual(new Set([a, b]))
  })

  it('ignores a matched word and a second selection on the same side replaces the first', async () => {
    const { env, client } = await clientWithWords(MATCHING_PAIRS)
    const run = MatchingRun.start(client, env)!
    const [a, b] = run.snapshot.left.map((e) => e.entryId)
    await run.select('left', a!)
    await run.select('left', b!)
    expect(run.snapshot.selected).toEqual({ side: 'left', entryId: b })
    await run.select('right', b!)
    await run.select('left', b!)
    expect(run.snapshot.selected).toBeNull()
    expect(run.snapshot.matched).toEqual(new Set([b]))
  })
})
