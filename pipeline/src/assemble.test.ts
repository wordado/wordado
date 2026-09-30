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
})
