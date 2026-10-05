import { describe, expect, it } from 'vitest'
import { languageOf } from './hosted'
import { snapshotFileKey } from './snapshot'

describe('languageOf', () => {
  it('maps queues to the language a reviewer needs', () => {
    expect(languageOf('translation-bg')).toBe('bg')
    expect(languageOf('title-es')).toBe('es')
    expect(languageOf('level')).toBe('en')
    expect(languageOf('english')).toBeNull()
    expect(languageOf('translation-fr')).toBeNull()
  })
})

describe('snapshotFileKey', () => {
  it('maps a review file to its JSON under the snapshot', () => {
    expect(snapshotFileKey('abc', 'review/translation-de/2026-10-03-01.csv')).toBe('snapshots/abc/translation-de/2026-10-03-01.json')
  })
})
