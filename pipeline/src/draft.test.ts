import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OfflineMiss } from './cache'
import type { PipelineConfig } from './config'
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
async function publishedV1(config: Partial<PipelineConfig> = {}): Promise<string> {
  const dir = makeContent({ config })
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

  const ALL_LEVELS: Partial<PipelineConfig> = { levels: ['A1', 'A2', 'B1', 'B2', 'C1'] }
  // New boundaries put almost every word in a far band; `sizes` keeps the old sizes, so only levels are in play.
  const FAR_BANDS: Partial<PipelineConfig> = { targets: { A1: 1, A2: 1, B1: 1, B2: 1, C1: 1 }, sizes: { A1: 62, A2: 2, B1: 1, B2: 1, C1: 1 } }

  it('without rebuild, new band boundaries move no published entry and no unit', async () => {
    const dir = await publishedV1(ALL_LEVELS)
    const before = readDraft(dir)
    editConfig(dir, { ...FAR_BANDS })
    const plain = await runDraft({ dir, llm: sampleLlm(), offline: true })
    expect(plain.entries.map((e) => [e.entry_id, e.level, e.level_flagged])).toEqual(before.entries.map((e) => [e.entry_id, e.level, false]))
    expect(plain.units.map((u) => [u.unit_id, u.entry_ids])).toEqual(before.units.map((u) => [u.unit_id, u.entry_ids]))
  })

  it('with rebuild, gives every entry its banded level and builds all units again, after the old numbers', async () => {
    const dir = await publishedV1(ALL_LEVELS)
    const before = readDraft(dir)
    editConfig(dir, { ...FAR_BANDS })
    const rebuilt = await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
    expect(rebuilt.problems).toEqual([])
    expect([...rebuilt.live].sort()).toEqual([...before.live].sort())
    const byId = new Map(rebuilt.entries.map((e) => [e.entry_id, e]))
    // go (rank 2, band A2) keeps the LLM's A1. bank's river sense (rank 27, band C1) is limited to two steps: B1.
    expect(byId.get('go-1')).toMatchObject({ level: 'A1', level_flagged: false })
    expect(byId.get('bank-2')).toMatchObject({ level_proposal: 'B1', level: 'B1', level_flagged: true })
    const oldIds = new Set(before.units.map((u) => u.unit_id))
    const liveUnits = rebuilt.units.filter((u) => u.entry_ids.length > 0)
    expect(liveUnits.every((u) => !oldIds.has(u.unit_id))).toBe(true)
    // Every live entry is in exactly one unit, of its own level.
    const placed = liveUnits.flatMap((u) => u.entry_ids.map((id) => [id, u.level] as const))
    expect(placed.map(([id]) => id).sort()).toEqual([...rebuilt.live].sort())
    expect(placed.every(([id, level]) => byId.get(id)!.level === level)).toBe(true)
    // the and go are still A1: their new unit takes the number after the four old A1 units.
    expect(rebuilt.units.find((u) => u.entry_ids.includes('go-1'))).toMatchObject({ unit_id: 'a1-05', level: 'A1' })
    // The old units stay in the registry, empty, so their numbers are never given out again.
    const registry = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8')) as { units: { unit_id: string; entry_ids: string[] }[] }
    expect(registry.units.filter((u) => oldIds.has(u.unit_id)).map((u) => u.entry_ids)).toEqual([...oldIds].map(() => []))
  })

  it('after a rebuild, a plain offline draft gives the same course and keeps the moved entry in the level queue', async () => {
    const dir = await publishedV1(ALL_LEVELS)
    editConfig(dir, { ...FAR_BANDS })
    const rebuilt = await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
    const again = await runDraft({ dir, llm: sampleLlm(), offline: true })
    expect(again.units).toEqual(rebuilt.units)
    expect(again.entries.map((e) => [e.entry_id, e.level, e.level_flagged])).toEqual(rebuilt.entries.map((e) => [e.entry_id, e.level, e.level_flagged]))
    const pending = pendingItems(again, Decisions.read(dir), ['bg'])
    expect(pending.get(QUEUES.level)!.find((i) => i.key === 'bank-2')).toMatchObject({ proposed: 'B1' })
    // A unit that lost all its words asks for no title.
    const emptied = ['a1-01', 'a1-02', 'a1-03', 'a1-04', 'a2-01']
    expect(pending.get(QUEUES.title('bg'))!.some((i) => emptied.includes(i.key))).toBe(false)
  })

  it('a second rebuild reuses no unit number and still places every live entry once', async () => {
    const dir = await publishedV1(ALL_LEVELS)
    editConfig(dir, { ...FAR_BANDS })
    const first = await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
    const second = await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
    const firstIds = new Set(first.units.map((u) => u.unit_id))
    const liveUnits = second.units.filter((u) => u.entry_ids.length > 0)
    expect(liveUnits.every((u) => !firstIds.has(u.unit_id))).toBe(true)
    expect(liveUnits.flatMap((u) => u.entry_ids).sort()).toEqual([...second.live].sort())
  })

  it('keeps a limited level flagged from draft to draft until the entry is published', async () => {
    // B1 has room for bank's river sense beside the pinned sample words, so it is live and gets a unit.
    const dir = makeContent({ config: { ...ALL_LEVELS, ...FAR_BANDS, sizes: { A1: 62, A2: 2, B1: 100, B2: 1, C1: 1 } } })
    const first = await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(first.live).toContain('bank-2')
    expect(first.entries.find((e) => e.entry_id === 'bank-2')).toMatchObject({ level: 'B1', level_flagged: true })
    const second = await runDraft({ dir, llm: sampleLlm(), offline: true })
    expect(second.entries.find((e) => e.entry_id === 'bank-2')).toMatchObject({ level: 'B1', level_flagged: true })
  })

  const fixLevel = (dir: string, key: string, proposed: string, value: string) =>
    Decisions.read(dir).append(QUEUES.level, [{ key, at: '2026-10-03T00:00:00Z', verdict: 'fix', proposed, value, by: 'r' }])
  const levelQueue = (dir: string, d: Awaited<ReturnType<typeof runDraft>>) => pendingItems(d, Decisions.read(dir), ['bg']).get(QUEUES.level)!

  it('a level a person chose is not a proposal to review again at the next draft', async () => {
    const dir = await publishedV1()
    fixLevel(dir, 'go-1', 'A1', 'A2')
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const second = await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(second.entries.find((e) => e.entry_id === 'go-1')!.level).toBe('A2')
    expect(levelQueue(dir, second).find((i) => i.key === 'go-1')).toBeUndefined()
  })

  it('after a rebuild, a level a person chose is not a proposal to review again either', async () => {
    const dir = await publishedV1(ALL_LEVELS)
    editConfig(dir, { ...FAR_BANDS })
    await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
    fixLevel(dir, 'bank-2', 'B1', 'B2')
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const second = await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(second.entries.find((e) => e.entry_id === 'bank-2')!.level).toBe('B2')
    expect(levelQueue(dir, second).find((i) => i.key === 'bank-2')).toBeUndefined()
  })

  it('main_meanings reaches the selection: a main meaning within the rule is live beyond the size', async () => {
    const live = async (main?: Record<string, 'all' | number>) => {
      const sizes = { A1: 1, A2: 2, B1: 1, B2: 1, C1: 1 }
      const dir = makeContent({ config: { sizes, ...(main ? { main_meanings: main } : {}) } })
      return new Set((await runDraft({ dir, llm: sampleLlm(), offline: false })).live)
    }
    const none = await live()
    const one = await live({ A1: 1 })
    const all = await live({ A1: 'all' })
    expect([none.has('the-1'), none.has('go-1')]).toEqual([false, false])
    expect([one.has('the-1'), one.has('go-1')]).toEqual([true, false])
    expect([all.has('the-1'), all.has('go-1')]).toEqual([true, true])
  })

  it('a rebuild with two published L1s releases both packs with every live entry', async () => {
    const dir = await publishedV1(ALL_LEVELS)
    nameThemesInGerman(dir)
    editConfig(dir, { l1s: ['bg', 'de'], accept_unreviewed: ['translation-de', 'title-de'] })
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const out2 = join(mkdtempSync(join(tmpdir(), 'release-')), 'out')
    writeRelease(dir, out2, planRelease(dir, { draft: false, now: '2026-10-05T09:00:00Z' }))
    adoptRelease(dir, out2)
    editConfig(dir, { ...FAR_BANDS, units_rebuilt_after: 2 })
    const rebuilt = await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
    approveAll(dir)
    const plan = planRelease(dir, { draft: false, now: '2026-10-06T09:00:00Z' })
    expect([plan.problems, plan.pending]).toEqual([[], []])
    expect(plan.outputs.map((o) => o.pack.l1).sort()).toEqual(['bg', 'de'])
    for (const o of plan.outputs) {
      expect(o.pack.entries.filter((e) => !e.retired).map((e) => e.entry_id).sort()).toEqual([...rebuilt.live].sort())
    }
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
    editConfig(dir, { l1s: ['bg', 'de'], accept_unreviewed: ['translation-de', 'title-de'] })
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    // The wrong order is set only after the draft has run with the right one, so the release check is what fires.
    editConfig(dir, { l1s: ['de', 'bg'] })
    expect(planRelease(dir, { draft: false, now: '2026-10-05T09:00:00Z' }).problems).toContain(
      "the lead L1 (the first in pipeline.json's l1s) must be one published before: senses merge on it; append a new L1 instead",
    )
  })

  it('keeps each L1’s translation fix for one word (a fix on both L1s ships as two fixes)', async () => {
    const dir = await publishedV1()
    nameThemesInGerman(dir)
    editConfig(dir, { l1s: ['bg', 'de'], accept_unreviewed: ['translation-de', 'title-de'] })
    const draft = await runDraft({ dir, llm: sampleLlm(), offline: false })
    const o2 = join(mkdtempSync(join(tmpdir(), 'release-')), 'out')
    writeRelease(dir, o2, planRelease(dir, { draft: false, now: '2026-10-05T09:00:00Z' }))
    adoptRelease(dir, o2)

    const go = draft.entries.find((e) => e.entry_id === 'go-1')!
    const d = Decisions.read(dir)
    d.append(QUEUES.translation('bg'), [{ key: 'go-1', at: '2026-10-06T00:00:00Z', verdict: 'reopen', by: 'reports' }])
    d.append(QUEUES.translation('bg'), [{ key: 'go-1', at: '2026-10-06T00:00:00Z', verdict: 'fix', proposed: go.l1['bg'], value: { ...go.l1['bg'], alternates: ['ходя', 'вървя'] }, by: 'r' }])
    d.append(QUEUES.translation('de'), [{ key: 'go-1', at: '2026-10-06T00:00:00Z', verdict: 'reopen', by: 'reports' }])
    d.append(QUEUES.translation('de'), [{ key: 'go-1', at: '2026-10-06T00:00:00Z', verdict: 'fix', proposed: go.l1['de'], value: { ...go.l1['de'], alternates: [...go.l1['de']!.alternates, 'laufen'] }, by: 'r' }])

    const o3 = join(mkdtempSync(join(tmpdir(), 'release-')), 'out')
    const plan = planRelease(dir, { draft: false, now: '2026-10-07T09:00:00Z' })
    writeRelease(dir, o3, plan)
    const fixes = JSON.parse(readFileSync(join(o3, 'fixes.json'), 'utf8')).fixes as { word_id: string; field: string; fixed_in: number; l1?: string }[]
    const goFixes = fixes.filter((f) => f.word_id === 'c:go-1' && f.fixed_in === 3 && f.field === 'translation')
    expect(goFixes.sort((a, b) => (a.l1! < b.l1! ? -1 : 1))).toEqual([
      { word_id: 'c:go-1', field: 'translation', fixed_in: 3, l1: 'bg' },
      { word_id: 'c:go-1', field: 'translation', fixed_in: 3, l1: 'de' },
    ])
  })

  it('carries a title-bg fix’s English into the German title too (plan 10)', async () => {
    const dir = await publishedV1()
    const before = readDraft(dir)
    const unit = before.units.find((u) => u.unit_id === 'a1-01')!
    const d = Decisions.read(dir)
    d.append(QUEUES.title('bg'), [
      { key: 'a1-01', at: '2026-10-03T00:00:00Z', verdict: 'fix', proposed: unit.titles['bg'], value: { ...unit.titles['bg'], en: 'People and greetings' }, by: 'r' },
    ])
    nameThemesInGerman(dir)
    editConfig(dir, { l1s: ['bg', 'de'], accept_unreviewed: ['translation-de', 'title-de'] })
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const plan = planRelease(dir, { draft: false, now: '2026-10-05T09:00:00Z' })
    expect([plan.problems, plan.pending]).toEqual([[], []])
    const bg = plan.outputs.find((o) => o.pack.l1 === 'bg')!.pack
    const de = plan.outputs.find((o) => o.pack.l1 === 'de')!.pack
    const bgTitle = bg.units.find((u) => u.unit_id === 'a1-01')!.title
    const deTitle = de.units.find((u) => u.unit_id === 'a1-01')!.title
    expect(bgTitle.en).toBe('People and greetings')
    expect(deTitle.en).toBe(bgTitle.en)
    expect(deTitle.l1).toBe('Lektion a1-01')
  })

  it('refuses a draft whose first L1 was never published, before any LLM stage runs', async () => {
    const dir = await publishedV1()
    nameThemesInGerman(dir)
    editConfig(dir, { l1s: ['de', 'bg'], accept_unreviewed: ['translation-de', 'title-de'] })
    const registryBefore = readFileSync(join(dir, 'registry.json'), 'utf8')
    const llm = sampleLlm()
    await expect(runDraft({ dir, llm, offline: false })).rejects.toThrow(
      "the lead L1 (the first in pipeline.json's l1s) must be one published before: senses merge on it; append a new L1 instead",
    )
    expect(llm.calls).toEqual([])
    expect(readFileSync(join(dir, 'registry.json'), 'utf8')).toEqual(registryBefore)
  })
})
