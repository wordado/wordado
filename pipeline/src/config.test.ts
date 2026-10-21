import { describe, expect, it } from 'vitest'
import { aiReviewRequired, configProblems, reviewQueues, themeProblems, type AiReviewConfig } from './config'
import { PROFILES } from './profiles'
import { contentPaths } from './content'

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

  it('accepts mp3 or pcm as a voice’s response format, and nothing else', () => {
    const withFormat = (response_format: string) => ({
      ...validConfig,
      tts: { ...validConfig.tts, accents: { uk: { ...validConfig.tts.accents.uk, response_format } } },
    })
    expect(configProblems(withFormat('pcm'))).toEqual([])
    expect(configProblems(withFormat('wav'))).toEqual(['tts.accents.uk.response_format: must be mp3 or pcm'])
  })

  it('refuses levels out of path order, which would make units go backwards', () => {
    expect(configProblems({ ...validConfig, levels: ['A2', 'A1'] })).toEqual(['levels: must be in CEFR order without repeats'])
  })

  it('accepts review queues of these L1s in accept_unreviewed, once each', () => {
    expect(configProblems({ ...validConfig, accept_unreviewed: ['english', 'level', 'title-bg', 'audio'] })).toEqual([])
    const queues = 'english, level, audio, translation-bg, title-bg'
    expect(configProblems({ ...validConfig, accept_unreviewed: ['english', 'title-de', 'english'] })).toEqual([
      `accept_unreviewed[1]: must be one of ${queues}`,
      'accept_unreviewed[2]: english appears twice',
    ])
    expect(configProblems({ ...validConfig, accept_unreviewed: 'english' })).toEqual(['accept_unreviewed: must be a list of review queues'])
  })

  it('accepts sizes, main_meanings and units_rebuilt_after, which are all optional', () => {
    expect(
      configProblems({
        ...validConfig,
        sizes: { A1: 600, A2: 1000, B1: 1500, B2: 1600, C1: 2000 },
        main_meanings: { A1: 'all', B1: 5100 },
        units_rebuilt_after: 5,
      }),
    ).toEqual([])
    expect(configProblems({ ...validConfig, units_rebuilt_after: 0 })).toEqual([])
  })

  it('names a missing size, a main_meanings rule of the wrong kind or for a level not shipped, and a bad version', () => {
    expect(
      configProblems({
        ...validConfig,
        sizes: { A1: 600, A2: 0, B1: 1500, B2: 1600 },
        main_meanings: { A1: 'every', B2: 'all', A2: 0 },
        units_rebuilt_after: -1,
      }),
    ).toEqual([
      'sizes.A2: must be a positive integer',
      'sizes.C1: must be a positive integer',
      'main_meanings.A1: must be "all" or a positive integer',
      'main_meanings.B2: must be a level this corpus ships',
      'main_meanings.A2: must be "all" or a positive integer',
      'units_rebuilt_after: must be a corpus version (0 or more)',
    ])
  })
})

describe('trial.open_theme', () => {
  it('trial may name only an open theme', () => {
    expect(configProblems({ ...validConfig, trial: { open_theme: 'home' } })).toEqual([])
  })

  it('refuses an empty open theme', () => {
    for (const bad of ['', 3]) expect(configProblems({ ...validConfig, trial: { open_theme: bad } })).toEqual(['trial.open_theme: must be a theme ID'])
  })
})

describe('trial.probes_per_level', () => {
  it('accepts 8 or more and refuses anything else', () => {
    expect(configProblems({ ...validConfig, trial: { probes_per_level: 40 } })).toEqual([])
    for (const bad of [7, 1.5, '40']) {
      expect(configProblems({ ...validConfig, trial: { probes_per_level: bad } })).toEqual(['trial.probes_per_level: must be an integer of 8 or more'])
    }
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

describe('ai_review', () => {
  const ai = {
    queues: ['translation-bg', 'title-bg', 'level'],
    reviewers: { flash: { provider: 'openrouter', model: 'google/gemini-3.8-flash' }, bggpt: { provider: 'local', url: 'http://127.0.0.1:8091', model: 'bggpt' } },
    default: 'flash',
    flag_when: 1,
  }
  it('accepts a valid block, and required defaults to the default reviewer', () => {
    expect(configProblems({ ...validConfig, l1s: ['bg'], ai_review: ai })).toEqual([])
    expect(aiReviewRequired(ai as AiReviewConfig)).toEqual(['flash'])
    expect(aiReviewRequired({ ...ai, required: ['flash', 'bggpt'] } as AiReviewConfig)).toEqual(['flash', 'bggpt'])
  })
  it('names every problem', () => {
    expect(
      configProblems({
        ...validConfig,
        l1s: ['bg'],
        ai_review: {
          queues: ['english', 'translation-de'],
          reviewers: { x: { provider: 'cloud', model: '' }, y: { provider: 'local', model: 'm' } },
          default: 'z',
          required: ['x', 'q'],
          flag_when: 3,
          flag_severity: 'severe',
        },
      }),
    ).toEqual([
      'ai_review.queues[0]: english is not a queue AI review covers (translation-<l1>, title-<l1>, level)',
      'ai_review.queues[1]: translation-de is not a queue of this content (l1s)',
      'ai_review.reviewers.x.provider: must be openrouter or local',
      'ai_review.reviewers.x.model: must be a non-empty string',
      'ai_review.reviewers.y.url: a local reviewer needs an http(s) URL',
      'ai_review.default: z is not a reviewer',
      'ai_review.required[1]: q is not a reviewer',
      'ai_review.flag_when: must be a whole number from 1 to 2 (the required reviewers)',
      'ai_review.flag_severity: must be minor or major',
    ])
  })
  it('is optional', () => {
    expect(configProblems({ ...validConfig })).toEqual([])
  })
})

describe('contentPaths', () => {
  it('keeps AI-review verdicts under ai-review/', () => {
    expect(contentPaths('/c').aiReview('translation-bg')).toBe('/c/ai-review/translation-bg.jsonl')
  })
})

describe('target', () => {
  const valid = () => validConfig
  const de = { target: 'de', l1s: ['bg', 'es', 'en'], tts: { ...valid().tts, accents: { de: valid().tts.accents.uk } } }
  it('accepts a German directory with a German voice', () => {
    expect(configProblems({ ...valid(), ...de })).toEqual([])
  })
  it('refuses a target it does not know', () => {
    expect(configProblems({ ...valid(), target: 'fr' })).toContain('target: must be one of en, de')
  })
  it('refuses an L1 that is the target', () => {
    expect(configProblems({ ...valid(), ...de, l1s: ['bg', 'de'] })).toContain('l1s: de is the target language')
  })
  it('asks for the target voices', () => {
    expect(configProblems({ ...valid(), target: 'de' })).toEqual(expect.arrayContaining(['tts.accents.de: required', 'tts.accents.uk: accent must be de']))
  })
  it('keeps the English messages', () => {
    expect(configProblems({ ...valid(), tts: { ...valid().tts, accents: { xx: valid().tts.accents.uk } } }))
      .toEqual(expect.arrayContaining(['tts.accents.uk: required', 'tts.accents.xx: accent must be uk or us']))
  })
  it('names the grammar queue only for a target with grammar', () => {
    expect(reviewQueues(['bg'], PROFILES.en)).toEqual(['english', 'level', 'audio', 'translation-bg', 'title-bg'])
    expect(reviewQueues(['bg'], PROFILES.de)).toEqual(['german', 'level', 'audio', 'grammar', 'translation-bg', 'title-bg'])
  })
  it('has no title queue for English as an L1 that is not the lead: its title is the lead’s English', () => {
    expect(reviewQueues(['bg', 'en'], PROFILES.de)).toEqual(['german', 'level', 'audio', 'grammar', 'translation-bg', 'title-bg', 'translation-en'])
    expect(reviewQueues(['en', 'bg'], PROFILES.de)).toEqual(['german', 'level', 'audio', 'grammar', 'translation-en', 'title-en', 'translation-bg', 'title-bg'])
  })
})
