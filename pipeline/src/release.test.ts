import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson, checkPackSuccession, loadCorpus, validatePack, type Pack } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { AiReviewStore, rowContent } from './aiReview/store'
import { sha256Hex } from './checksum'
import { Decisions, QUEUES } from './decisions'
import { readDraft, runDraft } from './draft'
import { levelSampled, pendingItems } from './queues'
import { writeJson } from './files'
import { publishProblems } from './publishable'
import { adoptRelease, planRelease, writeRelease } from './release'
import { approveAll, makeContent, recordAudio, sampleLlm } from './testing/fixture'

const NOW = '2026-10-02T09:00:00Z'
const out = () => join(mkdtempSync(join(tmpdir(), 'release-')), 'out')
const reader = (dir: string) => (path: string) => (existsSync(join(dir, path)) ? new Uint8Array(readFileSync(join(dir, path))) : null)
const packOf = (dir: string, file: string): Pack => {
  const r = validatePack(JSON.parse(readFileSync(join(dir, file), 'utf8')))
  if (r.status !== 'ok') throw new Error('invalid')
  return r.pack
}

async function reviewed(): Promise<string> {
  const dir = makeContent()
  await runDraft({ dir, llm: sampleLlm(), offline: false })
  await recordAudio(dir)
  approveAll(dir)
  return dir
}

const setConfig = (dir: string, change: Record<string, unknown>) => {
  const file = join(dir, 'pipeline.json')
  writeJson(file, { ...JSON.parse(readFileSync(file, 'utf8')), ...change })
}

/** Version 1 published, then new band boundaries and a rebuild, reviewed and ready for a release. */
async function rebuiltAfterV1(beforeRebuild: (dir: string) => void = () => {}): Promise<{ dir: string; v1: Pack }> {
  const dir = makeContent({ config: { levels: ['A1', 'A2', 'B1', 'B2', 'C1'] } })
  await runDraft({ dir, llm: sampleLlm(), offline: false })
  await recordAudio(dir)
  approveAll(dir)
  const o = out()
  writeRelease(dir, o, planRelease(dir, { draft: false, now: NOW }))
  adoptRelease(dir, o)
  const v1 = packOf(join(dir, 'last-published'), 'corpus-v1-bg.pack')
  setConfig(dir, { targets: { A1: 1, A2: 1, B1: 1, B2: 1, C1: 1 }, sizes: { A1: 62, A2: 2, B1: 1, B2: 1, C1: 1 } })
  beforeRebuild(dir)
  await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
  approveAll(dir)
  return { dir, v1 }
}

describe('planRelease and writeRelease', () => {
  it('refuses a rebuilt corpus whose old units are gone, unless units_rebuilt_after names the last published version', async () => {
    const { dir, v1 } = await rebuiltAfterV1()
    const refused = planRelease(dir, { draft: false, now: NOW })
    expect(refused.unitsRebuilt).toBe(false)
    expect(refused.problems).toEqual(v1.units.map((u) => `bg: units: unit ${u.unit_id} was removed`))
    setConfig(dir, { units_rebuilt_after: 1 })
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect(plan.unitsRebuilt).toBe(true)
    expect([plan.problems, plan.pending]).toEqual([[], []])
    const o = out()
    writeRelease(dir, o, plan)
    expect(publishProblems(reader(o))).toEqual([])
    const v2 = packOf(o, 'corpus-v2-bg.pack')
    const liveIds = (p: Pack) => p.entries.filter((e) => !e.retired).map((e) => e.entry_id).sort()
    expect(liveIds(v2)).toEqual(liveIds(v1))
    expect(v2.units.some((u) => v1.units.some((old) => old.unit_id === u.unit_id))).toBe(false)
    expect(loadCorpus([v2]).entries.size).toBe(v1.entries.length)
    // The setting names version 1 only: once version 2 is published, it allows nothing.
    adoptRelease(dir, o)
    expect(planRelease(dir, { draft: false, now: NOW }).unitsRebuilt).toBe(false)
  })

  it('carries an entry dropped before a rebuild, retired, in its old unit', async () => {
    const { dir, v1 } = await rebuiltAfterV1((d) => {
      const the = readDraft(d).entries.find((e) => e.entry_id === 'the-1')!
      Decisions.read(d).append(QUEUES.translation('bg'), [{ key: 'the-1', at: NOW, verdict: 'drop', proposed: the.l1['bg']!, by: 'r' }])
    })
    setConfig(dir, { units_rebuilt_after: 1 })
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect([plan.problems, plan.pending, plan.retired]).toEqual([[], [], ['the-1']])
    const o = out()
    writeRelease(dir, o, plan)
    const v2 = packOf(o, 'corpus-v2-bg.pack')
    const old = v1.entries.find((e) => e.entry_id === 'the-1')!
    expect(v2.entries.find((e) => e.entry_id === 'the-1')).toEqual({ ...old, retired: true })
    expect(v2.units.find((u) => u.unit_id === old.unit_id)).toMatchObject({ level: 'A1', entry_ids: ['the-1'] })
  })

  it('carries an entry dropped after a rebuild, retired, in its old unit only', async () => {
    const { dir, v1 } = await rebuiltAfterV1()
    const go = readDraft(dir).entries.find((e) => e.entry_id === 'go-1')!
    Decisions.read(dir).append(QUEUES.translation('bg'), [{ key: 'go-1', at: NOW, verdict: 'drop', proposed: go.l1['bg']!, by: 'r' }])
    // Online: the unit that loses a word is named again.
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    approveAll(dir)
    setConfig(dir, { units_rebuilt_after: 1 })
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect([plan.problems, plan.pending, plan.retired]).toEqual([[], [], ['go-1']])
    const o = out()
    writeRelease(dir, o, plan)
    const v2 = packOf(o, 'corpus-v2-bg.pack')
    const old = v1.entries.find((e) => e.entry_id === 'go-1')!
    expect(v2.entries.find((e) => e.entry_id === 'go-1')).toEqual({ ...old, retired: true })
    expect(v2.units.filter((u) => u.entry_ids.includes('go-1')).map((u) => u.unit_id)).toEqual([old.unit_id])
  })

  it('releases a fully reviewed corpus as version 1, a valid successor of the sample', async () => {
    const dir = await reviewed()
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect([plan.problems, plan.pending]).toEqual([[], []])
    const o = out()
    writeRelease(dir, o, plan)
    expect(readdirSync(o).sort()).toEqual(['audio', 'corpus-v1-bg.pack', 'credits.json', 'fixes.json', 'manifest.json', 'release.json'])
    expect(publishProblems(reader(o))).toEqual([])
    const v1 = packOf(o, 'corpus-v1-bg.pack')
    const v0 = packOf(join(dir, 'last-published'), 'corpus-v0-bg.pack')
    expect(checkPackSuccession(v0, v1)).toEqual([])
    expect(v1.entries.filter((e) => !e.retired)).toHaveLength(64)
    // bank has two live senses, so both ship their Bulgarian gloss; a lone sense ships none (Decision 8).
    expect(v1.entries.filter((e) => e.headword === 'bank').map((e) => e.sense)).toEqual(['за пари', 'на река'])
    expect(v1.entries.find((e) => e.entry_id === 'hello-1')).toMatchObject({ sense: '', audio: { uk: 'hello-1-uk-1' } })
    expect(v1.units.map((u) => [u.unit_id, u.order])).toEqual([['a1-01', 1], ['a1-02', 2], ['a1-03', 3], ['a1-04', 4], ['a2-01', 5]])
    expect(loadCorpus([v1]).entries.size).toBe(64)
    expect(JSON.parse(readFileSync(join(o, 'release.json'), 'utf8'))).toEqual({ corpus_version: 1, draft: false, built_at: NOW, l1s: ['bg'], attributions: [] })
  })

  it('refuses while anything awaits review, naming it; a draft builds anyway and cannot be published', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect(plan.problems).toEqual([])
    expect(plan.pending).toContain('hello-1: translation (bg) not reviewed')
    expect(plan.pending).toContain('hello-1: no current uk clip; run corpus audio')
    expect(() => writeRelease(dir, out(), plan)).toThrow(/awaits review/)
    const o = out()
    writeRelease(dir, o, planRelease(dir, { draft: true, now: NOW }))
    expect(publishProblems(reader(o))).toEqual(['release.json: a draft build cannot be published'])
  })

  it('ships the open items of accepted queues as proposed, counts them in release.json, and still gates the rest', async () => {
    const dir = makeContent({ config: { accept_unreviewed: ['english', 'level', 'title-bg', 'audio'] } })
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    await recordAudio(dir)
    const before = planRelease(dir, { draft: false, now: NOW })
    expect(before.pending.length).toBeGreaterThan(0)
    expect(before.pending.every((p) => p.endsWith('translation (bg) not reviewed'))).toBe(true)

    // A reviewer does only the Bulgarian translations.
    const decisions = Decisions.read(dir)
    const t = QUEUES.translation('bg')
    const pending = pendingItems(readDraft(dir), decisions, ['bg']).get(t)!
    decisions.append(t, pending.map((i) => ({ key: i.key, at: NOW, verdict: 'ok' as const, proposed: i.proposed, by: 'Мария' })))

    const plan = planRelease(dir, { draft: false, now: NOW })
    expect([plan.problems, plan.pending]).toEqual([[], []])
    const counts = plan.releaseInfo.unreviewed!
    expect(Object.keys(counts).sort()).toEqual(['audio', 'english', 'level', 'title-bg'])
    expect(counts['english']).toBe(64)
    expect(plan.unreviewed.filter((u) => u.queue === 'english')).toHaveLength(64)
    const o = out()
    writeRelease(dir, o, plan)
    expect(publishProblems(reader(o))).toEqual([])
    expect(JSON.parse(readFileSync(join(o, 'release.json'), 'utf8')).unreviewed).toEqual(counts)
    // Nothing was recorded as reviewed: the accepted queues' items are still open for a later review.
    expect(pendingItems(readDraft(dir), Decisions.read(dir), ['bg']).get(QUEUES.english)).toHaveLength(64)
  })

  it('carries an entry the last version had and this one does not, retired with its published fields', async () => {
    const dir = await reviewed()
    const o1 = out()
    writeRelease(dir, o1, planRelease(dir, { draft: false, now: NOW }))
    adoptRelease(dir, o1)
    const theV1 = packOf(o1, 'corpus-v1-bg.pack').entries.find((e) => e.entry_id === 'the-1')!
    const draft = JSON.parse(readFileSync(join(dir, 'work', 'draft.json'), 'utf8'))
    const the = draft.entries.find((e: { entry_id: string }) => e.entry_id === 'the-1')
    Decisions.read(dir).append(QUEUES.translation('bg'), [{ key: 'the-1', at: NOW, verdict: 'drop', proposed: the.l1.bg, by: 'r' }])
    // Online: unit a1-04 has new words, so it is named again.
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    approveAll(dir)
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect([plan.problems, plan.pending, plan.retired]).toEqual([[], [], ['the-1']])
    const o2 = out()
    writeRelease(dir, o2, plan)
    const v2 = packOf(o2, 'corpus-v2-bg.pack')
    expect(v2.entries.find((e) => e.entry_id === 'the-1')).toEqual({ ...theV1, retired: true })
    expect(checkPackSuccession(packOf(o1, 'corpus-v1-bg.pack'), v2)).toEqual([])
  })

  it('records a reviewer’s fix in fixes.json, after the earlier fixes', async () => {
    const dir = await reviewed()
    const o1 = out()
    writeRelease(dir, o1, planRelease(dir, { draft: false, now: NOW }))
    adoptRelease(dir, o1)
    const fixesV1 = JSON.parse(readFileSync(join(o1, 'fixes.json'), 'utf8'))
    const go = JSON.parse(readFileSync(join(dir, 'work', 'draft.json'), 'utf8')).entries.find((e: { entry_id: string }) => e.entry_id === 'go-1')
    const d = Decisions.read(dir)
    d.append(QUEUES.translation('bg'), [{ key: 'go-1', at: NOW, verdict: 'reopen', by: 'reports' }])
    d.append(QUEUES.translation('bg'), [{ key: 'go-1', at: NOW, verdict: 'fix', proposed: go.l1.bg, value: { ...go.l1.bg, alternates: ['ходя', 'вървя'] }, by: 'r' }])
    const o2 = out()
    writeRelease(dir, o2, planRelease(dir, { draft: false, now: NOW }))
    const fixes = JSON.parse(readFileSync(join(o2, 'fixes.json'), 'utf8'))
    expect(fixes.corpus_version).toBe(2)
    expect(fixes.fixes.slice(0, fixesV1.fixes.length)).toEqual(fixesV1.fixes)
    expect(fixes.fixes.slice(fixesV1.fixes.length)).toEqual([{ word_id: 'c:go-1', field: 'translation', fixed_in: 2, l1: 'bg' }])
  })

  it('carries, retired, an entry only the last published pack knows', async () => {
    const dir = await reviewed()
    const lp = join(dir, 'last-published')
    const v0 = packOf(lp, 'corpus-v0-bg.pack')
    const ghost = { ...v0.entries.find((e) => e.entry_id === 'hello-1')!, entry_id: 'ghost-1', headword: 'ghost', audio: {} }
    const units = v0.units.map((u) => (u.unit_id === 'a1-01' ? { ...u, entry_ids: [...u.entry_ids, 'ghost-1'] } : u))
    const bytes = new TextEncoder().encode(canonicalJson({ ...v0, entries: [...v0.entries, ghost], units }))
    writeFileSync(join(lp, 'corpus-v0-bg.pack'), bytes)
    const manifest = JSON.parse(readFileSync(join(lp, 'manifest.json'), 'utf8'))
    manifest.packs[0] = { ...manifest.packs[0], sha256: sha256Hex(bytes), bytes: bytes.length }
    writeJson(join(lp, 'manifest.json'), manifest)
    await runDraft({ dir, llm: sampleLlm(), offline: true })
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect(plan.problems).toEqual([])
    const o = out()
    writeRelease(dir, o, plan)
    expect(packOf(o, 'corpus-v1-bg.pack').entries.find((e) => e.entry_id === 'ghost-1')).toMatchObject({ retired: true, unit_id: 'a1-01' })
  })

  it('flags a decision recorded after the draft instead of silently shipping it stale', async () => {
    const dir = await reviewed()
    const draft = JSON.parse(readFileSync(join(dir, 'work', 'draft.json'), 'utf8'))

    // A drop on a live, non-pinned entry: nothing reruns the draft to notice it is no longer live.
    const go = draft.entries.find((e: { entry_id: string }) => e.entry_id === 'go-1')
    Decisions.read(dir).append(QUEUES.translation('bg'), [{ key: 'go-1', at: NOW, verdict: 'drop', proposed: go.l1.bg, by: 'r' }])
    const dropPlan = planRelease(dir, { draft: false, now: NOW })
    expect(dropPlan.pending).toContain('go-1: decided since the draft; run corpus draft')
    expect(() => writeRelease(dir, out(), dropPlan)).toThrow(/awaits review/)

    // A level fix on another live entry: e.level still holds the draft's value until it reruns.
    const the = draft.entries.find((e: { entry_id: string }) => e.entry_id === 'the-1')
    const newLevel = the.level === 'A1' ? 'A2' : 'A1'
    Decisions.read(dir).append(QUEUES.level, [{ key: 'the-1', at: NOW, verdict: 'fix', proposed: the.level_proposal, value: newLevel, by: 'r' }])
    const levelPlan = planRelease(dir, { draft: false, now: NOW })
    expect(levelPlan.pending).toContain('the-1: decided since the draft; run corpus draft')
    expect(() => writeRelease(dir, out(), levelPlan)).toThrow(/awaits review/)
  })

  it('refuses to adopt a release that is not last-published’s immediate successor', async () => {
    const dir = await reviewed()
    const o1 = out()
    writeRelease(dir, o1, planRelease(dir, { draft: false, now: NOW }))
    adoptRelease(dir, o1)
    expect(() => adoptRelease(dir, o1)).toThrow(/corpus version 1, but last-published\/ is at 1; it can only adopt version 2/)
  })

  it('refuses to write into a directory that is not empty', async () => {
    const dir = await reviewed()
    const o = out()
    mkdirSync(o, { recursive: true })
    writeFileSync(join(o, 'stray'), '')
    expect(() => writeRelease(dir, o, planRelease(dir, { draft: false, now: NOW }))).toThrow(/not empty/)
  })

  it('checks the licence register again at release', async () => {
    const dir = await reviewed()
    const sources = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8'))
    writeJson(join(dir, 'sources.json'), [{ ...sources[0], cleared_by: '', cleared_on: '' }])
    expect(() => planRelease(dir, { draft: false, now: NOW })).toThrow(/not cleared/)
  })

  it('lists a source’s required attribution in release.json', async () => {
    const dir = await reviewed()
    const sources = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8'))
    writeJson(join(dir, 'sources.json'), [{ ...sources[0], attribution: 'Frequencies from the Invented Corpus (CC BY 4.0).' }])
    expect(planRelease(dir, { draft: false, now: NOW }).releaseInfo.attributions).toEqual([
      { source: 'Invented test list', attribution: 'Frequencies from the Invented Corpus (CC BY 4.0).' },
    ])
  })

  it('writes credits.json beside the manifest, from the same attributions', async () => {
    const dir = await reviewed()
    const sources = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8')) as unknown[]
    writeJson(join(dir, 'sources.json'), [{ ...(sources[0] as object), attribution: 'Frequencies from the Invented Corpus (CC BY 4.0).' }])
    const o = out()
    writeRelease(dir, o, planRelease(dir, { draft: false, now: NOW }))
    expect(JSON.parse(readFileSync(join(o, 'credits.json'), 'utf8'))).toEqual({
      schema_version: 1,
      corpus_version: 1,
      sources: [{ source: 'Invented test list', attribution: 'Frequencies from the Invented Corpus (CC BY 4.0).' }],
    })
    expect(publishProblems(reader(o))).toEqual([])
  })

  it('blocks a release on AI review, even for a queue in accept_unreviewed, and passes once it is done', async () => {
    const dir = await reviewed() // drafted, audio, everything approved
    const config = JSON.parse(readFileSync(join(dir, 'pipeline.json'), 'utf8'))
    // Reopen a level row the level queue actually covers (flagged or sampled), so it is open again.
    const draft = readDraft(dir)
    const decisions = Decisions.read(dir)
    const key = draft.entries.find((e) => draft.live.includes(e.entry_id) && (e.level_flagged || levelSampled(e.entry_id)))!.entry_id
    decisions.append(QUEUES.level, [{ key, at: '2026-10-03T00:00:00Z', verdict: 'reopen', by: 'reports', note: '1 report: too easy' }])
    writeJson(join(dir, 'pipeline.json'), {
      ...config,
      accept_unreviewed: ['level'],
      ai_review: { queues: ['level'], reviewers: { flash: { provider: 'openrouter', model: 'f' } }, default: 'flash', flag_when: 1 },
    })
    const blocked = planRelease(dir, { draft: false, now: NOW })
    expect(blocked.pending.some((l) => l.endsWith('not yet AI-reviewed (level)'))).toBe(true)

    // Review it: an ok verdict matching the row's current content clears the gate.
    const item = pendingItems(readDraft(dir), decisions, config.l1s).get(QUEUES.level)!.find((i) => i.key === key)!
    const store = AiReviewStore.read(dir)
    store.append(QUEUES.level, [
      {
        key,
        reviewer: 'flash',
        model: 'f',
        prompt_version: 1,
        content: rowContent(QUEUES.level, item.proposed, item.context['reopened'] ?? ''),
        verdict: 'ok',
        objections: [],
        at: NOW,
      },
    ])
    const cleared = planRelease(dir, { draft: false, now: NOW })
    expect(cleared.pending.some((l) => l.endsWith('not yet AI-reviewed (level)'))).toBe(false)
  })
})
