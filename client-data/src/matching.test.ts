import { Grade, MATCHING_PAIRS } from '@wordado/core'
import { describe, expect, it } from 'vitest'
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

  it('matches pairs from either side, records each as practice, and grades a missed pair Again', async () => {
    const { env, client } = await clientWithWords(MATCHING_PAIRS)
    const states = client.snapshot.states
    const run = MatchingRun.start(client, env)!
    const { left, right } = run.snapshot
    expect(left).toHaveLength(MATCHING_PAIRS)
    expect(new Set(right)).toEqual(new Set(left))
    const [a, b] = [left[0]!.entryId, left[1]!.entryId]

    await run.select('left', a)
    await run.select('right', b)
    expect(run.snapshot).toMatchObject({ selected: null, miss: { left: a, right: b } })
    expect(run.snapshot.matched.size).toBe(0)

    await run.select('right', a)
    await run.select('left', a)
    expect(run.snapshot.matched).toEqual(new Set([a]))
    expect(run.snapshot.miss).toBeNull()

    for (const entry of left.slice(1)) {
      await run.select('left', entry.entryId)
      await run.select('right', entry.entryId)
    }
    expect(run.snapshot.done).toBe(true)
    // Practice never touches the schedule (spec §7.4).
    expect(client.snapshot.states).toEqual(states)
    const practiced = client.snapshot.progress
    expect(practiced).not.toBeNull()
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
