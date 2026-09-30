import { describe, expect, it } from 'vitest'
import { assemble } from './assemble'
import { readAudioRecords } from './audio'
import { readConfig, readThemes } from './config'
import { Decisions } from './decisions'
import { readDraft, runDraft } from './draft'
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
})
