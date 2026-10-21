import { describe, expect, it } from 'vitest'
import type { Grammar } from '@wordado/core'
import { assemble } from './assemble'
import { readAudioRecords } from './audio'
import { readConfig, readThemes } from './config'
import { Decisions, QUEUES } from './decisions'
import { readDraft, runDraft, type Draft, type DraftEntry } from './draft'
import { readLastPublished } from './lastPublished'
import { makeContent, sampleLlm } from './testing/fixture'

describe('assemble', () => {
  it('names a headword with several live senses that lacks an L1 gloss, whatever the reviewers say', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const draft = readDraft(dir)
    const noGloss = {
      ...draft,
      entries: draft.entries.map((e) => (e.entry_id === 'bank-2' ? { ...e, l1: { bg: { ...e.l1['bg']!, sense: '' } } } : e)),
    }
    const config = readConfig(dir)
    const out = assemble({
      l1: 'bg', corpusVersion: 1, draft: noGloss, decisions: Decisions.read(dir), themes: readThemes(dir, ['bg']),
      records: readAudioRecords(dir), config, previous: readLastPublished(dir).packs.get('bg') ?? null, previousLeadUnits: [], hasClip: () => true,
    })
    expect(out.problems).toEqual(['bank-2: bank (noun) has 2 live entries, so it needs a bg sense gloss'])
  })

  it('gives a non-lead pack’s unit that is not live the English of the lead’s last published title (final review)', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    // Nothing is live: every unit is carried from the previous pack, its entries retired.
    const draft = { ...readDraft(dir), live: [] }
    const config = { ...readConfig(dir), l1s: ['bg', 'de'] }
    const bg = readLastPublished(dir).packs.get('bg')!
    const retitle = (units: typeof bg.units, title: { en: string; l1: string }) => units.map((u) => (u.unit_id === 'a1-01' ? { ...u, title } : u))
    // German's last published pack, with the English it shipped then.
    const previous = { ...bg, pack_id: 'corpus-de', l1: 'de', units: retitle(bg.units, { en: 'Old English title', l1: 'Lektion eins' }) }
    const previousLeadUnits = retitle(bg.units, { en: 'People and greetings', l1: 'Хора и поздрави' })
    const run = (lead: typeof bg.units) =>
      assemble({ l1: 'de', corpusVersion: 1, draft, decisions: Decisions.read(dir), themes: [], records: readAudioRecords(dir), config, previous, previousLeadUnits: lead, hasClip: () => true })
    const title = (out: ReturnType<typeof assemble>) => (out.source['units'] as { unit_id: string; title: unknown }[]).find((u) => u.unit_id === 'a1-01')!.title
    expect(title(run(previousLeadUnits))).toEqual({ en: 'People and greetings', l1: 'Lektion eins' })
    // With the lead never published, the pack keeps its own last English.
    expect(title(run([]))).toEqual({ en: 'Old English title', l1: 'Lektion eins' })
  })

  it('packs a German course: its target, pack ID, grammar and review queue', () => {
    const dir = makeContent()
    const base = readConfig(dir)
    const config = { ...base, target: 'de' as const, l1s: ['bg'], tts: { ...base.tts, accents: { de: base.tts.accents.uk! } } }
    const entry = (entry_id: string, headword: string, pos: DraftEntry['pos'], grammar?: Grammar): DraftEntry => ({
      entry_id, headword, pos, sense_en: '', rank: 1, order: 0, pinned: false, essential: false, band: 'A1', level_proposal: 'A1', level: 'A1',
      level_flagged: false, themes: [], english: { ipa: 'x', variants: [], examples: ['Beispiel.'] },
      l1: { bg: { translation: 'превод', alternates: [], sense: '' } }, ...(grammar ? { grammar } : {}),
    })
    const entries = [
      entry('de.haus-1', 'Haus', 'noun', { gender: 'n', plural: 'Häuser' }),
      entry('de.gehen-1', 'gehen', 'verb', { separable: false, irregular: true, auxiliary: 'sein' }),
      entry('de.gross-1', 'groß', 'adj'),
    ]
    const draft: Draft = {
      live: entries.map((e) => e.entry_id), entries, problems: [],
      units: [{ unit_id: 'a1-01', level: 'A1', entry_ids: entries.map((e) => e.entry_id), titles: { bg: { en: 'Home', l1: 'Дом' } } }],
    }
    const run = () => assemble({
      l1: 'bg', corpusVersion: 1, draft, decisions: Decisions.read(dir), themes: [], records: [], config, previous: null, previousLeadUnits: [], hasClip: () => true,
    })
    const out = run()
    const packed = () => out.source['entries'] as { entry_id: string; pos: string; grammar?: unknown }[]
    expect(out.source['target']).toBe('de')
    expect(out.source['pack_id']).toBe('corpus-de-bg')
    expect(packed().find((e) => e.entry_id === 'de.haus-1')!.grammar).toEqual({ gender: 'n', plural: 'Häuser' })
    expect('grammar' in packed().find((e) => e.pos === 'adj')!).toBe(false)
    expect(out.pending.some((l) => l.includes('german not reviewed'))).toBe(true)
    expect(out.pending).toContain('de.haus-1: grammar not reviewed')

    Decisions.read(dir).append(QUEUES.grammar, [
      { key: 'de.haus-1', at: '2026-10-21T10:00:00Z', by: 'r', verdict: 'fix', proposed: { gender: 'n', plural: 'Häuser' }, value: { gender: 'f', plural: 'Häuser' } },
    ])
    const fixed = run()
    expect((fixed.source['entries'] as { entry_id: string; grammar?: unknown }[]).find((e) => e.entry_id === 'de.haus-1')!.grammar).toEqual({ gender: 'f', plural: 'Häuser' })
    expect(fixed.pending).not.toContain('de.haus-1: grammar not reviewed')
  })

  it('gives English as a non-lead L1 the lead’s reviewed English as its whole title', () => {
    const dir = makeContent()
    const base = readConfig(dir)
    const config = { ...base, target: 'de' as const, l1s: ['bg', 'en'], tts: { ...base.tts, accents: { de: base.tts.accents.uk! } } }
    const e: DraftEntry = {
      entry_id: 'de.haus-1', headword: 'Haus', pos: 'noun', sense_en: '', rank: 1, order: 0, pinned: false, essential: false, band: 'A1', level_proposal: 'A1', level: 'A1',
      level_flagged: false, themes: [], english: { ipa: 'x', variants: [], examples: ['Beispiel.'] },
      l1: { bg: { translation: 'къща', alternates: [], sense: '' }, en: { translation: 'house', alternates: [], sense: '' } }, grammar: { gender: 'n', plural: 'Häuser' },
    }
    const draft: Draft = {
      live: [e.entry_id], entries: [e], problems: [],
      units: [{ unit_id: 'de.a1-01', level: 'A1', entry_ids: [e.entry_id], titles: { bg: { en: 'Home', l1: 'Дом' }, en: { en: 'Home', l1: 'Home' } } }],
    }
    const decisions = Decisions.read(dir)
    // The lead's reviewer changes the English title; a stray title-en decision changes nothing.
    decisions.append(QUEUES.title('bg'), [{ key: 'de.a1-01', at: '2026-10-21T10:00:00Z', by: 'r', verdict: 'fix', proposed: { en: 'Home', l1: 'Дом' }, value: { en: 'At home', l1: 'Вкъщи' } }])
    decisions.append(QUEUES.title('en'), [{ key: 'de.a1-01', at: '2026-10-21T10:00:00Z', by: 'r', verdict: 'fix', proposed: { en: 'Home', l1: 'Home' }, value: { en: 'Home', l1: 'Houses' } }])
    const out = assemble({ l1: 'en', corpusVersion: 1, draft, decisions: Decisions.read(dir), themes: [], records: [], config, previous: null, previousLeadUnits: [], hasClip: () => true })
    expect((out.source['units'] as { title: unknown }[])[0]!.title).toEqual({ en: 'At home', l1: 'At home' })
    expect(out.pending.some((l) => l.includes('title (en)'))).toBe(false)
  })
})
