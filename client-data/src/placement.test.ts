import { PLACEMENT_PROBE_SIZE, type CefrLevel, type Corpus } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { PlacementRun, placementAvailable, type PlacementSource } from './placement'
import { ITEM_SETTLE_MS } from './run'
import { leveledCorpus, openSampleClient } from './testing/sample'
import { testEnv, type TestEnv } from './testing/testEnv'

async function source(levels: readonly CefrLevel[]): Promise<PlacementSource & { chosen: CefrLevel[] }> {
  const client = await openSampleClient()
  const corpus: Corpus = leveledCorpus(client.snapshot.corpus!, levels)
  const chosen: CefrLevel[] = []
  return {
    corpus,
    chosen,
    setLevel: async (level) => {
      chosen.push(level)
    },
  }
}

/** Answers the question on screen, right or wrong, past the settle time. */
function answer(run: PlacementRun, env: TestEnv, right: boolean): void {
  env.advance(ITEM_SETTLE_MS + 500)
  const item = run.snapshot.item!
  if (right) run.choose(item.answerIndex)
  else run.dontKnow()
}

describe('PlacementRun (spec §7.2)', () => {
  it('is unavailable on the A1-only sample, so the demo does not offer it', async () => {
    const client = await openSampleClient()
    expect(placementAvailable(client.snapshot.corpus)).toBe(false)
    expect(placementAvailable(null)).toBe(false)
    const run = PlacementRun.start({ corpus: client.snapshot.corpus, setLevel: async () => undefined }, testEnv())
    expect(run.snapshot).toMatchObject({ phase: 'unavailable', item: null })
  })

  it('asks multiple-choice questions from the middle band first', async () => {
    const src = await source(['A1', 'A2', 'B1'])
    expect(placementAvailable(src.corpus)).toBe(true)
    const run = PlacementRun.start(src, testEnv())
    expect(run.snapshot.phase).toBe('question')
    expect(run.snapshot.levels).toEqual(['A1', 'A2', 'B1'])
    expect(run.snapshot.item?.mode).toBe('multiple_choice')
    expect(run.snapshot.item?.entry.level).toBe('A2')
    expect(run.snapshot.item?.direction).toBe('en_to_l1')
  })

  it('places a learner who knows everything at the highest band, and records nothing until accepted', async () => {
    const src = await source(['A1', 'A2', 'B1'])
    const env = testEnv()
    const run = PlacementRun.start(src, env)
    for (let i = 0; i < 40 && run.snapshot.phase === 'question'; i += 1) answer(run, env, true)
    expect(run.snapshot).toMatchObject({ phase: 'result', result: 'B1' })
    expect(run.snapshot.asked).toBeLessThanOrEqual(2 * PLACEMENT_PROBE_SIZE)
    expect(src.chosen).toEqual([])
    await run.accept()
    expect(src.chosen).toEqual(['B1'])
    expect(run.snapshot.phase).toBe('accepted')
  })

  it('places a learner who knows nothing at A1', async () => {
    const src = await source(['A1', 'A2', 'B1'])
    const env = testEnv()
    const run = PlacementRun.start(src, env)
    for (let i = 0; i < 40 && run.snapshot.phase === 'question'; i += 1) answer(run, env, false)
    expect(run.snapshot.result).toBe('A1')
  })

  it('ignores an answer within the settle time, and one after the test is decided', async () => {
    const src = await source(['A1', 'A2', 'B1'])
    const env = testEnv()
    const run = PlacementRun.start(src, env)
    run.choose(run.snapshot.item!.answerIndex)
    expect(run.snapshot.asked).toBe(0)
    for (let i = 0; i < 40 && run.snapshot.phase === 'question'; i += 1) answer(run, env, false)
    const asked = run.snapshot.asked
    run.dontKnow()
    expect(run.snapshot.asked).toBe(asked)
  })

  it('never asks the same word twice', async () => {
    const src = await source(['A1', 'A2', 'B1'])
    const env = testEnv()
    const run = PlacementRun.start(src, env)
    const seen = new Set<string>()
    for (let i = 0; i < 40 && run.snapshot.phase === 'question'; i += 1) {
      const id = run.snapshot.item!.wordId
      expect(seen.has(id)).toBe(false)
      seen.add(id)
      answer(run, env, i % 2 === 0)
    }
  })

  it('shows the error and stays on the result when saving the level fails', async () => {
    const src = await source(['A1', 'A2', 'B1'])
    const env = testEnv()
    const run = PlacementRun.start({ ...src, setLevel: async () => Promise.reject(new Error('disk full')) }, env)
    for (let i = 0; i < 40 && run.snapshot.phase === 'question'; i += 1) answer(run, env, true)
    await run.accept()
    expect(run.snapshot).toMatchObject({ phase: 'result', error: 'disk full' })
  })
})
