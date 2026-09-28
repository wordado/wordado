import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OfflineMiss } from './cache'
import { Decisions, QUEUES } from './decisions'
import { readDraft, runDraft } from './draft'
import { writeJson } from './files'
import type { Llm, LlmRequest } from './llm'
import { adoptRelease, planRelease, writeRelease } from './release'
import { LicenceError } from './sources'
import type { SenseProposal } from './stages/senses'
import { approveAll, FIXTURE_TSV, makeContent, recordAudio, sampleLlm } from './testing/fixture'

/** A content directory whose first draft was reviewed, released as version 1 and recorded in last-published/. */
async function publishedV1(): Promise<string> {
  const dir = makeContent()
  await runDraft({ dir, llm: sampleLlm(), offline: false })
  await recordAudio(dir)
  approveAll(dir)
  const out = join(mkdtempSync(join(tmpdir(), 'release-')), 'out')
  writeRelease(dir, out, planRelease(dir, { draft: false, now: '2026-10-02T09:00:00Z' }))
  adoptRelease(dir, out)
  return dir
}

const editConfig = (dir: string, change: Record<string, unknown>) => {
  const file = join(dir, 'pipeline.json')
  writeJson(file, { ...JSON.parse(readFileSync(file, 'utf8')), ...change })
}

describe('runDraft', () => {
  it('keeps all 60 sample IDs live in their units, and places the new words', async () => {
    const dir = makeContent()
    const draft = await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(draft.problems).toEqual([])
    expect(draft.live).toEqual(expect.arrayContaining(['hello-1', 'thank_you-1', 'money-1']))
    expect(draft.live).toHaveLength(64)
    const byId = new Map(draft.entries.map((e) => [e.entry_id, e]))
    expect(byId.get('go-1')).toMatchObject({ pos: 'verb', level: 'A1', l1: { bg: { translation: 'отивам', alternates: ['ходя'], sense: '' } } })
    expect(byId.get('the-1')).toMatchObject({ pos: 'det', level: 'A1' })
    // money and building both translate as банка, so they merge; river stays apart (Decision 8).
    expect(draft.entries.filter((e) => e.headword === 'bank').map((e) => [e.entry_id, e.sense_en])).toEqual([['bank-1', 'money'], ['bank-2', 'river']])
    expect(draft.units.map((u) => [u.unit_id, u.entry_ids.length])).toEqual([['a1-01', 20], ['a1-02', 20], ['a1-03', 20], ['a1-04', 2], ['a2-01', 2]])
    expect(draft.units[3]!.titles).toEqual({ bg: { en: 'Unit a1-04', l1: 'Урок a1-04' } })
    expect(readDraft(dir).live).toEqual(draft.live)
    expect(JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8')).entries).toHaveLength(64)
  })

  it('pays for nothing the second time, and runs offline from the cache', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const again = sampleLlm()
    const draft = await runDraft({ dir, llm: again, offline: true })
    expect(again.calls).toEqual([])
    expect(draft.live).toHaveLength(64)
  })

  it('offline, names the stage that is not cached', async () => {
    await expect(runDraft({ dir: makeContent(), llm: sampleLlm(), offline: true })).rejects.toThrow(OfflineMiss)
  })

  it('a dropped entry leaves the live set, and a level fix moves it to a unit of its new level', async () => {
    const dir = makeContent()
    const first = await runDraft({ dir, llm: sampleLlm(), offline: false })
    const go = first.entries.find((e) => e.entry_id === 'go-1')!
    const the = first.entries.find((e) => e.entry_id === 'the-1')!
    const d = Decisions.read(dir)
    d.append(QUEUES.translation('bg'), [{ key: 'the-1', at: '2026-10-01T00:00:00Z', verdict: 'drop', proposed: the.l1['bg'], by: 'r' }])
    d.append(QUEUES.level, [{ key: 'go-1', at: '2026-10-01T00:00:00Z', verdict: 'fix', proposed: go.level, value: 'A2', by: 'r' }])
    // Not offline: go-1 and bank-1 land in reshaped units (a2-01 loses bank-2, a2-02 is new), so their
    // titles are asked again (titles.ts: "a unit whose words change is named again").
    const second = await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(second.live).not.toContain('the-1')
    expect(second.entries.find((e) => e.entry_id === 'go-1')!.level).toBe('A2')
    // go-1 is A2 now, and outranks bank-2 for the A2 target of 2; bank-2 was never published, so it simply leaves.
    expect(second.units.find((u) => u.entry_ids.includes('go-1'))).toMatchObject({ unit_id: 'a2-02', level: 'A2' })
    expect(second.live).not.toContain('bank-2')
  })

  it('names a pinned sample entry the senses stage no longer proposes', async () => {
    const inner = sampleLlm()
    const llm: Llm = {
      model: 'fake',
      spentUsd: () => 0,
      json: async <T,>(req: LlmRequest<T>): Promise<T> => {
        const out = await inner.json(req)
        if (req.name !== 'senses') return out
        return (out as unknown as SenseProposal[][]).map((senses) => senses.filter((s) => s.headword !== 'hello')) as unknown as T
      },
    }
    const draft = await runDraft({ dir: makeContent(), llm, offline: false })
    expect(draft.problems).toEqual(['pinned entry hello-1 (hello, intj) is not live: the senses stage no longer proposes it'])
  })

  it('makes an essential word live at the LLM’s level, sends it to banding review, and counts it toward the target', async () => {
    const dir = makeContent()
    writeFileSync(join(dir, 'essentials.txt'), '# test\nOkay\n')
    const draft = await runDraft({ dir, llm: sampleLlm(), offline: false })
    const okay = draft.entries.find((e) => e.headword === 'okay')!
    expect(okay).toMatchObject({ entry_id: 'okay-1', essential: true, level: 'A1', level_flagged: true })
    expect(draft.live).toContain('okay-1')
    // A1's target of 62 is now the 60 sample words, okay and the; go (rank 2) no longer fits.
    expect(draft.live).toContain('the-1')
    expect(draft.live).not.toContain('go-1')
    expect(draft.problems).toEqual([])
  })

  it('keeps a published lemma live when a list refresh pushes it past max_lemmas (Decision 9)', async () => {
    const dir = await publishedV1()
    // the and go rank first and second; bank, third, is now past the cut.
    editConfig(dir, { max_lemmas: 2 })
    const draft = await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(draft.live).toEqual(expect.arrayContaining(['bank-1', 'bank-2']))
    expect(draft.entries.find((e) => e.entry_id === 'bank-1')).toMatchObject({ level: 'A2', rank: 3 })
    expect(draft.problems).toEqual([])
  })

  it('keeps a published sense live when its banded level leaves the shipped levels (Decision 9)', async () => {
    const dir = await publishedV1()
    // Two sample words now outrank bank, and small targets put rank 5 in the C1 band, so bank's A2 clamps to B1.
    writeFileSync(join(dir, 'sources', 'invented.tsv'), `${FIXTURE_TSV}hello\t20000\nmoney\t10000\n`)
    editConfig(dir, { targets: { A1: 1, A2: 1, B1: 1, B2: 1, C1: 1 } })
    const draft = await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(draft.entries.find((e) => e.entry_id === 'bank-1')).toMatchObject({ band: 'C1', level_proposal: 'A2', level: 'A2' })
    expect(draft.live).toEqual(expect.arrayContaining(['bank-1', 'bank-2']))
  })

  it('stops before reading anything when a source is not cleared', async () => {
    const dir = makeContent()
    writeJson(join(dir, 'sources.json'), [{ id: 'x', file: 'invented.tsv', commercial_use: true, share_alike: false, cleared_by: '', cleared_on: '' }])
    const llm = sampleLlm()
    await expect(runDraft({ dir, llm, offline: false })).rejects.toThrow(LicenceError)
    expect(llm.calls).toEqual([])
  })
})
