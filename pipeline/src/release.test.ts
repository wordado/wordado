import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson, checkPackSuccession, loadCorpus, validatePack, type Pack } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from './checksum'
import { Decisions, QUEUES } from './decisions'
import { runDraft } from './draft'
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

describe('planRelease and writeRelease', () => {
  it('releases a fully reviewed corpus as version 1, a valid successor of the sample', async () => {
    const dir = await reviewed()
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect([plan.problems, plan.pending]).toEqual([[], []])
    const o = out()
    writeRelease(dir, o, plan)
    expect(readdirSync(o).sort()).toEqual(['audio', 'corpus-v1-bg.pack', 'fixes.json', 'manifest.json', 'release.json'])
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
    expect(fixes.fixes.slice(fixesV1.fixes.length)).toEqual([{ word_id: 'c:go-1', field: 'translation', fixed_in: 2 }])
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
})
