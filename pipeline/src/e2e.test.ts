import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPackSuccession, loadCorpus, offeredThemes, validatePack, type Pack } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { audioQueueItems, readAudioRecords } from './audio'
import { readConfig } from './config'
import { formatCsv, parseCsv } from './csv'
import { Decisions } from './decisions'
import { readDraft, runDraft } from './draft'
import { readLastPublished } from './lastPublished'
import { publishProblems } from './publishable'
import { PROFILES } from './profiles'
import { exportQueues, importQueues, pendingItems, queueSpecs } from './queues'
import { adoptRelease, planRelease, writeRelease } from './release'
import { triage } from './reports'
import { approveAll, makeContent, recordAudio, sampleLlm } from './testing/fixture'

/** The reviewer: opens every review file, says ok to each row, and edits the rows `edits` names first. */
function review(dir: string, edits: Record<string, Record<string, string>> = {}): void {
  const root = join(dir, 'review')
  for (const queue of readdirSync(root)) {
    for (const file of readdirSync(join(root, queue)).filter((f) => f.endsWith('.csv'))) {
      const path = join(root, queue, file)
      const rows = parseCsv(readFileSync(path, 'utf8'))
      const header = rows[0]!
      for (const row of rows.slice(1)) {
        for (const [col, value] of Object.entries(edits[`${queue}:${row[0]}`] ?? {})) row[header.indexOf(col)] = value
        row[header.indexOf('verdict')] = 'ok'
      }
      writeFileSync(path, formatCsv(rows))
    }
  }
}

function queues(dir: string, stamp: string): string[] {
  const config = readConfig(dir)
  const decisions = Decisions.read(dir)
  const items = pendingItems(readDraft(dir), decisions, config.l1s, PROFILES.en)
  items.set('audio', audioQueueItems(readAudioRecords(dir), decisions))
  return exportQueues(dir, items, queueSpecs(config.l1s, PROFILES.en), { stamp })
}

const pack = (dir: string, file: string): Pack => {
  const r = validatePack(JSON.parse(readFileSync(join(dir, file), 'utf8')))
  if (r.status !== 'ok') throw new Error('invalid pack')
  return r.pack
}
const reader = (dir: string) => (p: string) => {
  try {
    return new Uint8Array(readFileSync(join(dir, p)))
  } catch {
    return null
  }
}

describe('the corpus pipeline, end to end (spec §13)', () => {
  it('drafts, reviews through spreadsheets, releases v1, triages reports and releases the fix as v2', async () => {
    const dir = makeContent()
    const specs = queueSpecs(['bg'], PROFILES.en)

    await runDraft({ dir, llm: sampleLlm(), offline: false })
    await recordAudio(dir, '20261001T1000')
    expect(queues(dir, '2026-10-01').length).toBeGreaterThan(3)
    review(dir, { 'translation-bg:go-1': { alternates: 'ходя | вървя' } })
    expect(importQueues(dir, specs, { by: 'Мария', now: '2026-10-01T12:00:00Z' }).errors).toEqual([])
    expect(readdirSync(join(dir, 'review')).flatMap((q) => readdirSync(join(dir, 'review', q)))).toEqual([])

    const v1Dir = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'v1')
    const plan1 = planRelease(dir, { draft: false, now: '2026-10-01T13:00:00Z' })
    expect([plan1.problems, plan1.pending]).toEqual([[], []])
    writeRelease(dir, v1Dir, plan1)
    expect(publishProblems(reader(v1Dir))).toEqual([])
    const v0 = readLastPublished(dir).packs.get('bg')!
    const v1 = pack(v1Dir, 'corpus-v1-bg.pack')
    expect(checkPackSuccession(v0, v1)).toEqual([])
    expect(v1.entries.find((e) => e.entry_id === 'go-1')).toMatchObject({ translation: 'отивам', alternates: ['ходя', 'вървя'] })
    expect(offeredThemes(loadCorpus([v1])).map((t) => t.themeId)).toEqual(offeredThemes(loadCorpus([v0])).map((t) => t.themeId))
    expect(readdirSync(v1Dir)).toEqual(expect.arrayContaining(['trial-v1-bg.trial', 'trial-manifest.json']))
    adoptRelease(dir, v1Dir)

    const reports = ['a', 'b'].map((reporter, i) => ({
      id: i + 1, word_id: 'c:go-1', field: 'translation' as const, note: i === 0 ? 'ида' : '', suggestion: '', pack_version: 1, reporter, received_at: Date.parse('2026-10-03T00:00:00Z'), l1: 'bg' as const,
    }))
    const decisions = Decisions.read(dir)
    const t = triage({ reports, decisions, records: readAudioRecords(dir), fixes: readLastPublished(dir).fixes.fixes, live: new Set(readDraft(dir).live), l1s: ['bg'], profile: PROFILES.en, threshold: 2, now: '2026-10-04T00:00:00Z' })
    for (const { queue, event } of t.events) decisions.append(queue, [event])
    expect(t.summary).toEqual(['go-1: translation-bg reopened (2 reports)'])

    await runDraft({ dir, llm: sampleLlm(), offline: true })
    expect(queues(dir, '2026-10-04')).toEqual(['review/translation-bg/2026-10-04-01.csv'])
    expect(planRelease(dir, { draft: false, now: '2026-10-04T01:00:00Z' }).pending).toEqual(['go-1: translation (bg) not reviewed'])
    review(dir, { 'translation-bg:go-1': { alternates: 'ходя | ида' } })
    importQueues(dir, specs, { by: 'Мария', now: '2026-10-04T02:00:00Z' })

    const v2Dir = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'v2')
    writeRelease(dir, v2Dir, planRelease(dir, { draft: false, now: '2026-10-04T03:00:00Z' }))
    const v2 = pack(v2Dir, 'corpus-v2-bg.pack')
    expect(checkPackSuccession(v1, v2)).toEqual([])
    expect(readdirSync(v2Dir)).toEqual(expect.arrayContaining(['trial-v2-bg.trial', 'trial-manifest.json']))
    // The trial follows the course: its units are the course's first unit of each level, as built in this version.
    const t2 = pack(v2Dir, 'trial-v2-bg.trial')
    const firstOfLevel = [...new Set(v2.units.map((u) => u.level))].map((l) => v2.units.filter((u) => u.level === l).sort((a, b) => a.order - b.order)[0]!.unit_id)
    expect(t2.units.map((u) => u.unit_id)).toEqual(firstOfLevel)
    expect(v2.entries.find((e) => e.entry_id === 'go-1')!.alternates).toEqual(['ходя', 'ида'])
    const fixes = JSON.parse(readFileSync(join(v2Dir, 'fixes.json'), 'utf8'))
    expect(fixes.fixes.filter((f: { fixed_in: number }) => f.fixed_in === 2)).toEqual([{ word_id: 'c:go-1', field: 'translation', fixed_in: 2, l1: 'bg' }])
  }, 30_000)

  it('rebuilds levels and units once, reviews the moved level in a spreadsheet, and releases v2 with every entry kept', async () => {
    const dir = makeContent({ config: { levels: ['A1', 'A2', 'B1', 'B2', 'C1'] } })
    const specs = queueSpecs(['bg'], PROFILES.en)
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    await recordAudio(dir, '20261001T1000')
    queues(dir, '2026-10-01')
    review(dir)
    expect(importQueues(dir, specs, { by: 'Мария', now: '2026-10-01T12:00:00Z' }).errors).toEqual([])
    const v1Dir = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'v1')
    writeRelease(dir, v1Dir, planRelease(dir, { draft: false, now: '2026-10-01T13:00:00Z' }))
    const v1 = pack(v1Dir, 'corpus-v1-bg.pack')
    adoptRelease(dir, v1Dir)

    // New band boundaries, and leave to replace version 1's units. The sizes stay those of the first draft, so only the levels are in play.
    const file = join(dir, 'pipeline.json')
    writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), targets: { A1: 1, A2: 1, B1: 1, B2: 1, C1: 1 }, sizes: { A1: 62, A2: 2, B1: 1, B2: 1, C1: 1 }, units_rebuilt_after: 1 }),
    )
    const rebuilt = await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
    expect(rebuilt.live).toHaveLength(v1.entries.length)
    const written = queues(dir, '2026-10-05')
    const levelFile = written.find((f) => f.startsWith('review/level/'))
    expect(levelFile).toBeDefined()
    expect(parseCsv(readFileSync(join(dir, levelFile!), 'utf8')).some((row) => row[0] === 'bank-2')).toBe(true)
    review(dir)
    expect(importQueues(dir, specs, { by: 'Мария', now: '2026-10-05T12:00:00Z' }).errors).toEqual([])
    await runDraft({ dir, llm: sampleLlm(), offline: true })

    const plan = planRelease(dir, { draft: false, now: '2026-10-05T13:00:00Z' })
    expect([plan.problems, plan.pending]).toEqual([[], []])
    const v2Dir = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'v2')
    writeRelease(dir, v2Dir, plan)
    expect(publishProblems(reader(v2Dir))).toEqual([])
    const v2 = pack(v2Dir, 'corpus-v2-bg.pack')
    expect(checkPackSuccession(v1, v2, { allowRemovedUnits: true })).toEqual([])
    expect(checkPackSuccession(v1, v2).map((e) => e.path)).toEqual(v1.units.map(() => 'units'))
    expect(v2.entries.find((e) => e.entry_id === 'bank-2')).toMatchObject({ level: 'B1', retired: false })
    expect(v2.units.find((u) => u.entry_ids.includes('bank-2'))!.level).toBe('B1')
    const fixes = JSON.parse(readFileSync(join(v2Dir, 'fixes.json'), 'utf8')) as { fixes: { word_id: string; field: string; fixed_in: number }[] }
    expect(fixes.fixes.some((f) => f.word_id === 'c:bank-2' && f.field === 'level' && f.fixed_in === 2)).toBe(true)
  }, 30_000)
})

describe('an English corpus with no target', () => {
  // The files under testing/english-release were written by this same flow on the code before a second target
  // language existed (#313): with no `target` in pipeline.json, the draft, review CSVs, packs, trial packs, manifests and
  // clip IDs stay byte for byte what they were. A difference is a regression to fix, never a snapshot to rewrite.
  const snapshots = join(dirname(fileURLToPath(import.meta.url)), 'testing', 'english-release')
  const filesUnder = (root: string): string[] =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => relative(root, join(d.parentPath, d.name)))
      .sort()

  it('exports the same review files and releases the same bytes as before', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const draftJson = readFileSync(join(dir, 'work', 'draft.json'))
    await recordAudio(dir, '20261001T1000')
    const csvs = queues(dir, '2026-10-01')
    approveAll(dir)
    const plan = planRelease(dir, { draft: false, now: '2026-10-01T13:00:00Z' })
    expect([plan.problems, plan.pending]).toEqual([[], []])
    const releaseDir = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'release')
    const files = writeRelease(dir, releaseDir, plan)

    const actual = new Map<string, Buffer>()
    for (const f of files.filter((f) => !f.startsWith('audio/'))) actual.set(f, readFileSync(join(releaseDir, f)))
    actual.set('audio.txt', Buffer.from(`${files.filter((f) => f.startsWith('audio/')).sort().join('\n')}\n`))
    for (const f of csvs) actual.set(f, readFileSync(join(dir, f)))
    actual.set(join('work', 'draft.json'), draftJson)

    expect([...actual.keys()].sort()).toEqual(filesUnder(snapshots))
    for (const [f, bytes] of actual) expect(bytes.toString('utf8'), f).toBe(readFileSync(join(snapshots, f), 'utf8'))
    for (const [f, bytes] of actual) expect(bytes.equals(readFileSync(join(snapshots, f))), f).toBe(true)
  }, 30_000)
})

describe('a German corpus', () => {
  it('drafts, reviews through spreadsheets, records audio and releases German packs for Bulgarian and English speakers', async () => {
    const dir = makeContent({
      config: { target: 'de', l1s: ['bg', 'en'], tts: { model: 'fake', max_clips_per_run: 1000, accents: { de: { voice: 'v', instructions: 'Say the German word once.' } } } },
    })
    const specs = queueSpecs(['bg', 'en'], PROFILES.de)
    await runDraft({ dir, llm: sampleLlm({ grammar: true }), offline: false })
    await recordAudio(dir, '20261021T1000')
    const decisions = Decisions.read(dir)
    const items = pendingItems(readDraft(dir), decisions, ['bg', 'en'], PROFILES.de)
    items.set('audio', audioQueueItems(readAudioRecords(dir), decisions))
    exportQueues(dir, items, specs, { stamp: '2026-10-21' })
    // The German profile's queues: headwords under its own name, and the grammar block.
    expect(existsSync(join(dir, 'review', 'german'))).toBe(true)
    expect(existsSync(join(dir, 'review', 'grammar'))).toBe(true)
    // English as a non-lead L1 reviews no titles of its own: they are the lead's English.
    expect(existsSync(join(dir, 'review', 'title-en'))).toBe(false)
    review(dir)
    expect(importQueues(dir, specs, { by: 'reviewer', now: '2026-10-21T12:00:00Z' }).errors).toEqual([])

    const plan = planRelease(dir, { draft: false, now: '2026-10-21T13:00:00Z' })
    expect([plan.problems, plan.pending]).toEqual([[], []])
    expect(plan.outputs.map((o) => o.pack.l1).sort()).toEqual(['bg', 'en'])
    const bg = plan.outputs.find((o) => o.pack.l1 === 'bg')!.pack
    expect(bg.target).toBe('de')
    expect(bg.pack_id).toBe('corpus-de-bg')
    expect(bg.entries.length).toBeGreaterThan(0)
    expect(bg.entries.every((e) => e.entry_id.startsWith('de.'))).toBe(true)
    expect(bg.units.every((u) => u.unit_id.startsWith('de.'))).toBe(true)
    const nouns = bg.entries.filter((e) => e.pos === 'noun')
    expect(nouns.length).toBeGreaterThan(0)
    expect(nouns.every((e) => e.grammar !== undefined && e.grammar !== null && 'gender' in e.grammar)).toBe(true)
    expect(Object.keys(bg.entries[0]!.audio)).toEqual(['de'])
    expect(plan.manifest.packs.every((d) => d.target === 'de')).toBe(true)
    for (const o of plan.outputs) expect(validatePack(JSON.parse(new TextDecoder().decode(o.packBytes))).status).toBe('ok')
    // An English speaker's unit titles are one English title, not two answers that could disagree.
    const en = plan.outputs.find((o) => o.pack.l1 === 'en')!.pack
    expect(en.pack_id).toBe('corpus-de-en')
    expect(en.units.every((u) => u.title.l1 === u.title.en)).toBe(true)
    expect(en.units.map((u) => u.title.en)).toEqual(bg.units.map((u) => u.title.en))
  }, 30_000)
})
