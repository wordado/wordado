import { describe, expect, it } from 'vitest'
import { hostedQueue, languageOf, languagesFor, queueParts, reviews } from './hosted'
import { snapshotDigestKey, snapshotFileKey } from './snapshot'

describe('languageOf', () => {
  it('maps queues to the language a reviewer needs', () => {
    expect(languageOf('translation-bg')).toBe('bg')
    expect(languageOf('title-es')).toBe('es')
    expect(languageOf('level')).toBe('en')
    expect(languageOf('english')).toBeNull()
    expect(languageOf('translation-fr')).toBeNull()
  })

  it('maps a second target’s queues: levels and grammar to the target, translations and titles to their L1, English among them', () => {
    expect(languageOf('de/level')).toBe('de')
    expect(languageOf('de/grammar')).toBe('de')
    expect(languageOf('de/translation-bg')).toBe('bg')
    expect(languageOf('de/title-en')).toBe('en')
    expect(languageOf('de/translation-de')).toBeNull()
    expect(languageOf('de/german')).toBeNull()
    expect(languageOf('grammar')).toBeNull()
    expect(languageOf('en/level')).toBeNull()
    expect(languageOf('fr/level')).toBeNull()
  })
})

describe('languagesFor', () => {
  it('asks a reviewer of a second target’s queue to read that target too', () => {
    expect(languagesFor('translation-bg')).toEqual(['bg'])
    expect(languagesFor('level')).toEqual(['en'])
    expect(languagesFor('de/translation-bg')).toEqual(['de', 'bg'])
    expect(languagesFor('de/title-en')).toEqual(['de', 'en'])
    expect(languagesFor('de/level')).toEqual(['de'])
    expect(languagesFor('english')).toBeNull()
  })

  it('lets a reviewer review a queue only with every language it needs', () => {
    expect(reviews({ languages: ['bg'] }, 'translation-bg')).toBe(true)
    expect(reviews({ languages: ['bg'] }, 'de/translation-bg')).toBe(false)
    expect(reviews({ languages: ['bg', 'de'] }, 'de/translation-bg')).toBe(true)
    expect(reviews({ languages: ['de'] }, 'de/level')).toBe(true)
    expect(reviews({ languages: ['de'] }, 'english')).toBe(false)
  })
})

describe('queueParts', () => {
  it('splits a queue into its target and its name in that corpus; English’s queues have no prefix', () => {
    expect(queueParts('translation-bg')).toEqual({ target: 'en', name: 'translation-bg' })
    expect(queueParts('de/level')).toEqual({ target: 'de', name: 'level' })
    expect(queueParts('fr/level')).toBeNull()
    expect(queueParts('en/level')).toBeNull()
    expect(hostedQueue('en', 'level')).toBe('level')
    expect(hostedQueue('de', 'level')).toBe('de/level')
  })
})

describe('snapshotFileKey', () => {
  it('maps a review file to its JSON under the snapshot', () => {
    expect(snapshotFileKey('abc', 'review/translation-de/2026-10-03-01.csv')).toBe('snapshots/abc/translation-de/2026-10-03-01.json')
  })

  it('keeps a second target’s files under its prefix, beside its queue’s digest', () => {
    expect(snapshotFileKey('abc', 'de/review/translation-bg/2026-10-03-01.csv')).toBe('snapshots/abc/de/translation-bg/2026-10-03-01.json')
    expect(snapshotDigestKey('abc', 'de/translation-bg')).toBe('snapshots/abc/de/translation-bg/digest.json')
  })
})
