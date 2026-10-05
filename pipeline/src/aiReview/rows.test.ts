import { describe, expect, it } from 'vitest'
import { Decisions, QUEUES } from '../decisions'
import { readDraft, runDraft } from '../draft'
import { pendingItems } from '../queues'
import { makeContent, sampleLlm } from '../testing/fixture'
import { reviewRows } from './rows'

describe('reviewRows', () => {
  it('gives a translation row its cells, example, other live senses and learner reports', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const draft = readDraft(dir)
    const queue = QUEUES.translation('bg')
    const items = pendingItems(draft, Decisions.read(dir), ['bg']).get(queue)!
    const rows = reviewRows(queue, items, draft, ['bg'])
    const first = rows[0]!
    expect(Object.keys(first.cells)).toEqual(['translation', 'alternates', 'sense'])
    expect(first.context).toMatchObject({ headword: expect.any(String), pos: expect.any(String), sense_en: expect.any(String), example: expect.any(String), learner_reports: '' })
    expect(Array.isArray(first.context['other_live_senses'])).toBe(true)
    // bank has two live senses in the fixture: each lists the other
    const bank = rows.find((r) => r.key === 'bank-1')
    if (bank) expect((bank.context['other_live_senses'] as { key: string }[]).map((s) => s.key)).toContain('bank-2')
  })
})
