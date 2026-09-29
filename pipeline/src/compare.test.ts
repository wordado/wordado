import { describe, expect, it } from 'vitest'
import { compareReport, compareStages, sampleEntries } from './compare'
import type { DraftEntry } from './draft'
import { runDraft } from './draft'
import { fakeLlm } from './llm'
import { makeContent, sampleLlm } from './testing/fixture'

describe('sampleEntries', () => {
  it('spreads the sample over the whole list, and takes everything from a short one', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ entry_id: `w${i}-1` }) as DraftEntry)
    expect(sampleEntries(entries, 3).map((e) => e.entry_id)).toEqual(['w0-1', 'w3-1', 'w6-1'])
    expect(sampleEntries(entries.slice(0, 2), 3)).toHaveLength(2)
  })
})

describe('compareStages', () => {
  it('asks the model under test in a throwaway cache and sets its answers beside the cached ones', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    // The model under test translates everything as "X" and finds no themes.
    const tested = fakeLlm((name, input) => {
      const items = (input as { items: { key: string }[] }).items
      if (name === 'translate') return { items: items.map((i) => ({ key: i.key, translation: 'X', alternates: [], sense: '' })) }
      if (name === 'themes') return { items: items.map((i) => ({ key: i.key, themes: [] })) }
      throw new Error(`not asked here: ${name}`)
    })
    const rows = await compareStages(dir, tested, { sample: 4, stages: ['translate', 'themes'] })
    expect(rows.filter((r) => r.stage === 'translate-bg')).toHaveLength(4)
    expect(rows.filter((r) => r.stage === 'translate-bg').every((r) => !r.same && r.fresh === 'X')).toBe(true)
    expect(rows.filter((r) => r.stage === 'themes')).toHaveLength(4)
    expect(tested.calls.map((c) => c.name).sort()).toEqual(['themes', 'translate'])
    // Asking again asks again: nothing went into the content caches.
    await compareStages(dir, tested, { sample: 4, stages: ['themes'] })
    expect(tested.calls.filter((c) => c.name === 'themes')).toHaveLength(2)

    const report = compareReport(rows, 'claude-code:claude-sonnet-5', '2026-09-29')
    expect(report).toContain('- **translate-bg**: 0 of 4 the same')
    expect(report).toContain('| ≠ ')
  })
})
