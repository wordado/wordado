import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { writeJson } from '../files'
import { readConfig } from '../config'
import { contentPaths } from '../content'
import { Decisions, QUEUES } from '../decisions'
import { readDraft, runDraft } from '../draft'
import { AnswerDoesNotFit, type Llm, type LlmRequest } from '../llm'
import { makeContent, sampleLlm } from '../testing/fixture'
import { runAiReview } from './run'

/** A reviewer that objects to every row whose key starts with "bank", and counts its calls. */
function fakeReviewer(opts: { unfitAbove?: number } = {}) {
  const calls: number[] = []
  const llm: Llm = {
    model: 'fake/reviewer',
    spentUsd: () => 0,
    async json<T>(req: LlmRequest<T>): Promise<T> {
      const rows = (req.input as { rows: { key: string }[] }).rows
      calls.push(rows.length)
      if (opts.unfitAbove !== undefined && rows.length > opts.unfitAbove) throw new AnswerDoesNotFit('review: too long')
      return req.parse({
        items: rows.map((r) => ({
          key: r.key,
          // Level rows are the only ones with a band; translation rows carry `level` too, in their context.
          errors: r.key.startsWith('bank') ? [{ field: 'band' in r ? 'level' : 'translation', category: 'band' in r ? 'too-low' : 'other', severity: 'major', reason: 'r', fix: 'band' in r ? 'C1' : 'X' }] : [],
          verdict: 'ok',
          confidence: 1,
        })),
      })
    },
  }
  return { llm, calls }
}

async function content() {
  const dir = makeContent()
  await runDraft({ dir, llm: sampleLlm(), offline: false })
  const config = readConfig(dir)
  writeJson(contentPaths(dir).config, {
    ...config,
    ai_review: { queues: ['translation-bg', 'level'], reviewers: { flash: { provider: 'openrouter', model: 'google/gemini-3.8-flash' } }, default: 'flash', flag_when: 1 },
  })
  return dir
}

describe('runAiReview', () => {
  it('reviews every open row once, stores the verdicts, and asks nothing the second time', async () => {
    const dir = await content()
    const r = fakeReviewer()
    const first = await runAiReview({ dir, reviewer: 'flash', llm: r.llm, concurrency: 2, now: () => '2026-10-05T08:00:00Z' })
    const tr = first.find((s) => s.queue === 'translation-bg')!
    expect(tr.asked).toBeGreaterThan(0)
    expect(tr.flagged).toBeGreaterThan(0)
    expect(r.calls.every((n) => n <= 10)).toBe(true)
    const lines = readFileSync(contentPaths(dir).aiReview('translation-bg'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { reviewer: string; model: string; prompt_version: number })
    expect(lines[0]).toMatchObject({ reviewer: 'flash', model: 'fake/reviewer', prompt_version: 1 })
    const again = await runAiReview({ dir, reviewer: 'flash', llm: r.llm, concurrency: 2, now: () => '2026-10-05T09:00:00Z' })
    expect(again.map((s) => s.asked)).toEqual([0, 0])
    expect(again.find((s) => s.queue === 'translation-bg')!.alreadyReviewed).toBe(tr.asked)
  })

  it('reviews one queue with --queue, and refuses one AI review does not cover', async () => {
    const dir = await content()
    const out = await runAiReview({ dir, reviewer: 'flash', queue: 'level', llm: fakeReviewer().llm, concurrency: 1, now: () => 'n' })
    expect(out.map((s) => s.queue)).toEqual(['level'])
    await expect(runAiReview({ dir, reviewer: 'flash', queue: 'english', llm: fakeReviewer().llm, concurrency: 1, now: () => 'n' })).rejects.toThrow(/english is not in ai_review.queues/)
    await expect(runAiReview({ dir, reviewer: 'nobody', llm: fakeReviewer().llm, concurrency: 1, now: () => 'n' })).rejects.toThrow(/nobody is not a reviewer/)
  })

  it('asks a batch whose answer never fits again in halves', async () => {
    const dir = await content()
    const r = fakeReviewer({ unfitAbove: 4 })
    const out = await runAiReview({ dir, reviewer: 'flash', queue: 'translation-bg', llm: r.llm, concurrency: 1, now: () => 'n' })
    expect(out[0]!.asked).toBeGreaterThan(4)
    expect(r.calls.some((n) => n > 4)).toBe(true)
    expect(r.calls.filter((n) => n <= 4).length).toBeGreaterThan(0)
  })

  it('asks again a row whose learner note changed after a run (its content hash moves)', async () => {
    const dir = await content()
    const r = fakeReviewer()
    const draft = readDraft(dir)
    const key = draft.live.find((k) => !k.startsWith('bank-'))!
    const first = await runAiReview({ dir, reviewer: 'flash', queue: 'translation-bg', llm: r.llm, concurrency: 2, now: () => 'n1' })
    expect(first[0]!.asked).toBeGreaterThan(0)
    Decisions.read(dir).append(QUEUES.translation('bg'), [{ key, at: 'n2', verdict: 'reopen', by: 'reports', note: 'learners reported: odd word' }])
    const second = await runAiReview({ dir, reviewer: 'flash', queue: 'translation-bg', llm: r.llm, concurrency: 2, now: () => 'n3' })
    expect(second[0]!.asked).toBe(1)
  })

  it('says plainly when pipeline.json has no ai_review block', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    await expect(runAiReview({ dir, reviewer: 'flash', llm: fakeReviewer().llm, concurrency: 1, now: () => 'n' })).rejects.toThrow('pipeline.json has no ai_review block')
  })
})
