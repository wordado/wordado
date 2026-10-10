import { describe, expect, it } from 'vitest'
import type { AudioRecord } from './audio'
import { Decisions, QUEUES } from './decisions'
import { pullReports, REPORTS_SQL, triage, type ReportRow } from './reports'
import { makeContent } from './testing/fixture'

const NOW = '2026-10-10T00:00:00Z'
const DAY = 86_400_000
const t0 = Date.parse('2026-10-05T00:00:00Z')
let nextId = 1
const r = (extra: Partial<ReportRow>): ReportRow => ({ id: nextId++, word_id: 'c:go-1', field: 'translation', note: '', suggestion: '', pack_version: 1, reporter: 'a', received_at: t0, l1: null, ...extra })
const input = (reports: ReportRow[], extra: Partial<Parameters<typeof triage>[0]> = {}) => ({
  reports,
  decisions: Decisions.read(makeContent()),
  records: [] as AudioRecord[],
  fixes: [],
  live: new Set(['go-1', 'water-1']),
  l1s: ['bg'],
  threshold: 2,
  now: NOW,
  ...extra,
})

describe('triage (spec §8.10, Decision 13)', () => {
  it('reopens a translation set when two different learners report it', () => {
    expect(triage(input([r({ reporter: 'a' })])).events).toEqual([])
    const out = triage(input([r({ reporter: 'a', note: 'should be "ида"' }), r({ reporter: 'b', field: 'other' })]))
    expect(out.events).toEqual([
      { queue: 'translation-bg', event: { key: 'go-1', at: NOW, verdict: 'reopen', by: 'reports', note: '2 reports (other, translation): should be "ида"' } },
    ])
    expect(out.summary).toEqual(['go-1: translation-bg reopened (2 reports)'])
  })

  it('puts what the learners suggest before their notes, so a reviewer sees it and a long note cannot cut it', () => {
    const one = triage(input([r({ note: 'means to walk here', suggestion: ' ида ' }), r({ reporter: 'b' })]))
    expect(one.events[0]!.event.note).toBe('2 reports (translation): suggested: „ида“ / means to walk here')
    const long = triage(input([r({ note: 'x'.repeat(400), suggestion: 'ида' }), r({ reporter: 'b', note: 'odd', suggestion: 'отивам' })]))
    expect(long.events[0]!.event.note).toHaveLength(280)
    expect(long.events[0]!.event.note).toMatch(/^2 reports \(translation\): suggested: „ида“ \/ suggested: „отивам“ \/ x+$/)
    // No suggestion, no word about one.
    expect(triage(input([r({ note: 'odd' }), r({ reporter: 'b' })])).events[0]!.event.note).toBe('2 reports (translation): odd')
  })

  it('counts one learner once, and each deleted account’s report on its own', () => {
    expect(triage(input([r({ reporter: 'a' }), r({ reporter: 'a' })])).events).toEqual([])
    expect(triage(input([r({ reporter: 'deleted:1' }), r({ reporter: 'deleted:2' })])).events).toHaveLength(1)
  })

  it('sends examples to the English queue and levels to the level queue', () => {
    const out = triage(input([r({ field: 'example' }), r({ field: 'example', reporter: 'b' }), r({ field: 'level' }), r({ field: 'level', reporter: 'b' })]))
    expect(out.events.map((e) => e.queue)).toEqual(['english', 'level'])
  })

  it('ignores reports made on a version before the field was last fixed, and reports already acted on', () => {
    const fixes = [{ word_id: 'c:go-1', field: 'translation' as const, fixed_in: 3 }]
    expect(triage(input([r({ pack_version: 2 }), r({ pack_version: 2, reporter: 'b' })], { fixes })).events).toEqual([])
    const dir = makeContent()
    const d = Decisions.read(dir)
    d.append(QUEUES.translation('bg'), [{ key: 'go-1', at: new Date(t0 + DAY).toISOString(), verdict: 'reopen', by: 'reports' }])
    expect(triage(input([r({}), r({ reporter: 'b' })], { decisions: d })).events).toEqual([])
    expect(triage(input([r({ received_at: t0 + 2 * DAY }), r({ reporter: 'b', received_at: t0 + 2 * DAY })], { decisions: d })).events).toHaveLength(1)
  })

  it('remakes a reported clip at the first report, once per clip', () => {
    const rec: AudioRecord = { clip_id: 'go-1-uk-1', entry_id: 'go-1', accent: 'uk', text: 'go', voice_key: 'k', generation: 1, batch: 'b', reason: 'new', created_at: '2026-10-01T00:00:00Z', seconds: 0.5 }
    const out = triage(input([r({ field: 'audio' })], { records: [rec] }))
    expect(out.events).toEqual([{ queue: 'audio', event: { key: 'go-1-uk-1', at: NOW, verdict: 'redo', proposed: 'go-1-uk-1', by: 'reports', note: '1 report' } }])
    const d = Decisions.read(makeContent())
    d.append(QUEUES.audio, [out.events[0]!.event])
    expect(triage(input([r({ field: 'audio' })], { records: [rec], decisions: d })).events).toEqual([])
  })

  it('skips personal words, entries that are not live, and audio reports older than the clip', () => {
    const rec: AudioRecord = { clip_id: 'go-1-uk-2', entry_id: 'go-1', accent: 'uk', text: 'go', voice_key: 'k', generation: 2, batch: 'b', reason: 'redo', created_at: '2026-10-06T00:00:00Z', seconds: 0.5 }
    expect(triage(input([r({ word_id: 'u:abc' }), r({ word_id: 'u:abc', reporter: 'b' }), r({ word_id: 'c:gone-1' }), r({ word_id: 'c:gone-1', reporter: 'b' }), r({ field: 'audio' })], { records: [rec] })).events).toEqual([])
  })

  it('is language-aware: a German translation fix does not suppress a Bulgarian translation report (plan 9)', () => {
    const fixes = [{ word_id: 'c:go-1', field: 'translation' as const, fixed_in: 3, l1: 'de' }]
    const out = triage(input([r({ pack_version: 1 }), r({ pack_version: 1, reporter: 'b' })], { fixes, l1s: ['bg', 'de'] }))
    expect(out.events.map((e) => e.queue)).toEqual(['translation-bg'])
  })

  it('treats a legacy translation fix (no l1) as Bulgarian: it suppresses a Bulgarian report but not a German one (plan 9, plan 10)', () => {
    const fixes = [{ word_id: 'c:go-1', field: 'translation' as const, fixed_in: 3 }]
    expect(triage(input([r({ pack_version: 1 }), r({ pack_version: 1, reporter: 'b' })], { fixes, l1s: ['bg', 'de'] })).events).toEqual([])
    const out = triage(input([r({ pack_version: 1, l1: 'de' }), r({ pack_version: 1, l1: 'de', reporter: 'b' })], { fixes, l1s: ['bg', 'de'] }))
    expect(out.events.map((e) => e.queue)).toEqual(['translation-de'])
  })

  it('triages a German translation report to translation-de only, leaving translation-bg alone (plan 10)', () => {
    const out = triage(input([r({ l1: 'de' }), r({ l1: 'de', reporter: 'b' })], { l1s: ['bg', 'de'] }))
    expect(out.events.map((e) => e.queue)).toEqual(['translation-de'])
  })

  it('treats a translation report naming no L1 as Bulgarian (every report from before plan 10 was one)', () => {
    const out = triage(input([r({ l1: null }), r({ l1: null, reporter: 'b' })], { l1s: ['bg', 'de'] }))
    expect(out.events.map((e) => e.queue)).toEqual(['translation-bg'])
  })

  it('reopens nothing for a translation report naming an L1 the pipeline no longer carries', () => {
    const out = triage(input([r({ l1: 'fr' }), r({ l1: 'fr', reporter: 'b' })], { l1s: ['bg', 'de'] }))
    expect(out.events).toEqual([])
  })
})

describe('pullReports', () => {
  it('hashes every reporter and keeps no raw user ID', async () => {
    const rows = await pullReports(async () => ({
      rows: [
        { id: '7', word_id: 'c:go-1', field: 'translation', note: 'x', pack_version: 1, reporter_id: 'user_123', received_at: '1760000000000', l1: 'de' },
        { id: 8, word_id: 'c:go-1', field: 'audio', note: '', pack_version: 1, reporter_id: null, received_at: 1760000000001, l1: null },
      ],
    }))
    expect(rows.map((x) => x.reporter)).toEqual([expect.stringMatching(/^[0-9a-f]{16}$/), 'deleted:8'])
    expect(JSON.stringify(rows)).not.toContain('user_123')
    expect(rows[0]).toMatchObject({ id: 7, received_at: 1760000000000, l1: 'de' })
    expect(rows[1]).toMatchObject({ l1: null })
  })

  it('reads the suggestion, and a row from before the column as having none', async () => {
    const rows = await pullReports(async () => ({
      rows: [
        { id: 1, word_id: 'c:go-1', field: 'translation', note: '', suggestion: 'ида', pack_version: 1, reporter_id: 'u', received_at: 1, l1: 'bg' },
        { id: 2, word_id: 'c:go-1', field: 'translation', note: 'x', pack_version: 1, reporter_id: 'u', received_at: 2, l1: 'bg' },
        { id: 3, word_id: 'c:go-1', field: 'translation', note: 'x', suggestion: null, pack_version: 1, reporter_id: 'u', received_at: 3, l1: 'bg' },
      ],
    }))
    expect(rows.map((x) => x.suggestion)).toEqual(['ида', '', ''])
    expect(REPORTS_SQL).toContain('suggestion')
  })

  it('skips a row with a field this build does not know', async () => {
    expect(await pullReports(async () => ({ rows: [{ id: 1, word_id: 'c:a-1', field: 'colour', note: '', pack_version: 1, reporter_id: 'u', received_at: 1 }] }))).toEqual([])
  })
})
