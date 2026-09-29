import { describe, expect, it } from 'vitest'
import { validateCredits } from './credits'

describe('validateCredits', () => {
  it('accepts the published shape and keeps only its known fields', () => {
    const file = { schema_version: 1, corpus_version: 1, sources: [{ source: 'FineWeb', attribution: 'Word frequencies counted from FineWeb (ODC-By 1.0).', extra: 1 }] }
    expect(validateCredits(file)).toEqual({ schema_version: 1, corpus_version: 1, sources: [{ source: 'FineWeb', attribution: 'Word frequencies counted from FineWeb (ODC-By 1.0).' }] })
    expect(validateCredits({ schema_version: 1, corpus_version: 0, sources: [] })).toEqual({ schema_version: 1, corpus_version: 0, sources: [] })
  })

  it('refuses another schema, a missing field, or an empty attribution', () => {
    expect(validateCredits({ schema_version: 2, corpus_version: 1, sources: [] })).toBeNull()
    expect(validateCredits({ schema_version: 1, sources: [] })).toBeNull()
    expect(validateCredits({ schema_version: 1, corpus_version: 1, sources: [{ source: 'x', attribution: ' ' }] })).toBeNull()
    expect(validateCredits('nope')).toBeNull()
    expect(validateCredits(null)).toBeNull()
  })
})
