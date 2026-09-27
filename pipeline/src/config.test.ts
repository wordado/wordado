import { describe, expect, it } from 'vitest'
import { configProblems, themeProblems } from './config'

export const validConfig = {
  l1s: ['bg'],
  levels: ['A1', 'A2', 'B1'],
  targets: { A1: 600, A2: 1000, B1: 1500, B2: 2000, C1: 2000 },
  max_forms: 12000,
  max_lemmas: 5000,
  unit_size: 20,
  report_threshold: 2,
  llm: { model: 'anthropic/claude-sonnet-5', concurrency: 4, max_usd_per_run: 40 },
  tts: {
    model: 'openai/gpt-4o-mini-tts-2025-12-15',
    accents: { uk: { voice: 'alloy', instructions: 'A neutral British accent.' } },
    max_clips_per_run: 4000,
  },
}

describe('configProblems', () => {
  it('accepts the template configuration', () => {
    expect(configProblems(validConfig)).toEqual([])
  })

  it('names every problem at once', () => {
    expect(
      configProblems({ ...validConfig, l1s: ['BG'], levels: ['A1', 'Z9'], unit_size: 0, llm: { ...validConfig.llm, model: '' } }),
    ).toEqual([
      'l1s[0]: must be a two-letter lowercase language code',
      'levels[1]: must be one of A1, A2, B1, B2, C1',
      'unit_size: must be a positive integer',
      'llm.model: must be a non-empty string',
    ])
  })

  it('needs a UK voice, the one accent every entry carries', () => {
    expect(configProblems({ ...validConfig, tts: { ...validConfig.tts, accents: {} } })).toEqual(['tts.accents.uk: required'])
  })

  it('refuses levels out of path order, which would make units go backwards', () => {
    expect(configProblems({ ...validConfig, levels: ['A2', 'A1'] })).toEqual(['levels: must be in CEFR order without repeats'])
  })
})

describe('themeProblems', () => {
  const theme = { theme_id: 'food', name: { en: 'Food', bg: 'Храна' }, description: { en: 'Food.', bg: 'Храна.' } }

  it('accepts a theme named in English and every L1', () => {
    expect(themeProblems([theme], ['bg'])).toEqual([])
  })

  it('names a theme missing an L1 name or repeated', () => {
    expect(themeProblems([theme, { ...theme, name: { en: 'Food' } }], ['bg'])).toEqual([
      'themes[1].theme_id: food appears twice',
      'themes[1].name.bg: required',
    ])
  })
})
