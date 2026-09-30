import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OfflineMiss } from './cache'
import { Decisions, QUEUES } from './decisions'
import { readDraft, runDraft } from './draft'
import { writeJson } from './files'
import type { Llm, LlmRequest } from './llm'
import { readLastPublished } from './lastPublished'
import { pendingItems } from './queues'
import { adoptRelease, planRelease, writeRelease } from './release'
import { LicenceError } from './sources'
import { SENSES_THEME_IDS, type SenseProposal } from './stages/senses'
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
    // the and go share no theme: a mixed unit with a plain title, not an LLM-invented one.
    expect(draft.units[3]).toMatchObject({ group: 'mixed', titles: { bg: { en: 'More words 1', l1: 'Още думи 1' } } })
    // bank is the third most frequent word; river, its third sense, ranks as if bank were nine times rarer.
    expect(draft.entries.find((e) => e.entry_id === 'bank-2')!.rank).toBe(27)
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

  it('makes as many LLM calls at a time as it is told, over llm.concurrency', async () => {
    const peak = async (concurrency?: number) => {
      const base = sampleLlm()
      let inFlight = 0
      let max = 0
      const llm: Llm = {
        ...base,
        json: async <T,>(req: LlmRequest<T>) => {
          max = Math.max(max, (inFlight += 1))
          await new Promise((r) => setTimeout(r, 2))
          try {
            return await base.json(req)
          } finally {
            inFlight -= 1
          }
        },
      }
      await runDraft({ dir: makeContent(), llm, offline: false, ...(concurrency ? { concurrency } : {}) })
      return max
    }
    expect(await peak(1)).toBe(1)
    // 64 translations go in four batches of 20.
    expect(await peak(3)).toBe(3)
  })

  it('offline, names the stage that is not cached', async () => {
    await expect(runDraft({ dir: makeContent(), llm: sampleLlm(), offline: true })).rejects.toThrow(OfflineMiss)
  })

  it('asks the themes of live entries in their own stage; the senses question keeps its fixed theme list', async () => {
    const dir = makeContent()
    const file = join(dir, 'themes.json')
    const extra = { theme_id: 'linking', name: { en: 'Linking words', bg: 'Свързващи думи' }, description: { en: 'Because, although.', bg: 'Защото, въпреки че.' } }
    writeJson(file, [...JSON.parse(readFileSync(file, 'utf8')), extra])
    const llm = sampleLlm()
    const draft = await runDraft({ dir, llm, offline: false })
    const senses = llm.calls.filter((c) => c.name === 'senses')
    expect(senses.length).toBeGreaterThan(0)
    for (const c of senses) expect((c.input as { themes: string[] }).themes).toEqual(SENSES_THEME_IDS)
    const asked = llm.calls.filter((c) => c.name === 'themes').flatMap((c) => (c.input as { items: unknown[] }).items)
    expect(asked).toHaveLength(64)
    expect((llm.calls.find((c) => c.name === 'themes')!.input as { themes: { id: string }[] }).themes.map((t) => t.id)).toContain('linking')
    expect(draft.entries.find((e) => e.entry_id === 'hello-1')!.themes).toEqual(['greetings'])
  })

  it('with regroup, rebuilds the units no published pack carries from the current themes', async () => {
    const dir = makeContent({ config: { unit_size: 4 } })
    const first = await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(first.units.find((u) => u.unit_id === 'a1-04')).toMatchObject({ entry_ids: ['the-1', 'go-1'], group: 'mixed' })
    // A new theme list asks the themes stage again, and it now puts the and go together.
    const file = join(dir, 'themes.json')
    const extra = { theme_id: 'linking', name: { en: 'Linking words', bg: 'Свързващи думи' }, description: { en: 'Because, although.', bg: 'Защото, въпреки че.' } }
    writeJson(file, [...JSON.parse(readFileSync(file, 'utf8')), extra])
    const base = sampleLlm()
    const llm: Llm = {
      ...base,
      json: <T,>(req: LlmRequest<T>) =>
        req.name === 'themes'
          ? Promise.resolve(req.parse({ items: (req.input as { items: { key: string; headword: string }[] }).items.map((i) => ({ key: i.key, themes: ['the', 'go'].includes(i.headword) ? ['actions'] : [] })) }))
          : base.json(req),
    }
    const kept = await runDraft({ dir, llm, offline: false })
    expect(kept.units.find((u) => u.unit_id === 'a1-04')).toMatchObject({ group: 'mixed' })
    const regrouped = await runDraft({ dir, llm, offline: false, regroup: true })
    const unit = regrouped.units.find((u) => u.unit_id === 'a1-04')!
    expect(unit).toMatchObject({ entry_ids: ['the-1', 'go-1'], titles: { bg: { en: 'Unit a1-04', l1: 'Урок a1-04' } } })
    expect(unit).not.toHaveProperty('group')
    // The sample's published units keep their words.
    expect(regrouped.units.filter((u) => ['a1-01', 'a1-02', 'a1-03'].includes(u.unit_id)).map((u) => u.entry_ids)).toEqual(first.units.slice(0, 3).map((u) => u.entry_ids))
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

  it('guarantees only an essential word’s first sense; its other senses compete like any word', async () => {
    const dir = makeContent()
    writeFileSync(join(dir, 'essentials.txt'), 'bank\n')
    const draft = await runDraft({ dir, llm: sampleLlm(), offline: false })
    const bank = draft.entries.filter((e) => e.headword === 'bank').map((e) => [e.sense_en, e.essential, e.level_flagged])
    // money is the first sense the stage lists; river is the third (building merged into money, Decision 8).
    expect(bank).toEqual([['money', true, true], ['river', false, false]])
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

const nameThemesInGerman = (dir: string) => {
  const file = join(dir, 'themes.json')
  const themes = JSON.parse(readFileSync(file, 'utf8')) as { name: Record<string, string>; description: Record<string, string> }[]
  writeJson(file, themes.map((t) => ({ ...t, name: { ...t.name, de: `DE ${t.name['en']}` }, description: { ...t.description, de: `DE ${t.description['en']}` } })))
}

describe('adding an L1 (plan 9)', () => {
  it('drafts German beside a published Bulgarian corpus without changing any Bulgarian word, unit, title or decision', async () => {
    const dir = await publishedV1()
    const before = readDraft(dir)
    nameThemesInGerman(dir)
    editConfig(dir, { l1s: ['bg', 'de'], accept_unreviewed: ['translation-de', 'title-de'] })
    const after = await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(after.live).toEqual(before.live)
    const bg = (d: typeof before) => d.entries.map((e) => [e.entry_id, e.headword, e.pos, e.sense_en, e.level, e.english, e.l1['bg']])
    expect(bg(after)).toEqual(bg(before))
    expect(after.units.map((u) => [u.unit_id, u.entry_ids, u.titles['bg']])).toEqual(before.units.map((u) => [u.unit_id, u.entry_ids, u.titles['bg']]))
    // Every Bulgarian review decision still holds: nothing Bulgarian is open again.
    const pending = pendingItems(after, Decisions.read(dir), ['bg', 'de'])
    expect(pending.get(QUEUES.translation('bg'))).toEqual([])
    expect(pending.get(QUEUES.title('bg'))).toEqual([])
    // German is there for every live entry, and bank's merged sense accepts both German words.
    const live = new Set(after.live)
    expect(after.entries.filter((e) => live.has(e.entry_id)).every((e) => e.l1['de'] !== undefined)).toBe(true)
    expect(after.entries.find((e) => e.entry_id === 'bank-1')!.l1['de']).toMatchObject({ translation: 'Bank', alternates: ['Bankgebäude'] })
  })

  it('releases a German pack beside an unchanged Bulgarian one, with no new Bulgarian fixes', async () => {
    const dir = await publishedV1()
    const v1 = readLastPublished(dir).packs.get('bg')!
    nameThemesInGerman(dir)
    editConfig(dir, { l1s: ['bg', 'de'], accept_unreviewed: ['translation-de', 'title-de'] })
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const plan = planRelease(dir, { draft: false, now: '2026-10-05T09:00:00Z' })
    expect([plan.problems, plan.pending]).toEqual([[], []])
    expect(plan.outputs.map((o) => o.pack.l1).sort()).toEqual(['bg', 'de'])
    const bg2 = plan.outputs.find((o) => o.pack.l1 === 'bg')!.pack
    expect(bg2.entries).toEqual(v1.entries)
    expect(bg2.units).toEqual(v1.units)
    expect(plan.fixes.fixes.filter((f) => f.fixed_in === 2)).toEqual([])
  })

  it('refuses a release whose first L1 was never published: senses merge on it', async () => {
    const dir = await publishedV1()
    nameThemesInGerman(dir)
    editConfig(dir, { l1s: ['de', 'bg'], accept_unreviewed: ['translation-de', 'title-de'] })
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(planRelease(dir, { draft: false, now: '2026-10-05T09:00:00Z' }).problems).toContain(
      "the lead L1 (the first in pipeline.json's l1s) must be one published before: senses merge on it; append a new L1 instead",
    )
  })
})
