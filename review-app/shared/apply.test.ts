import { formatCsv, csvRecords } from '@wordado/pipeline/csv'
import { describe, expect, it } from 'vitest'
import { applyDecisions, invalidDecision } from './apply'

const rules = { columns: ['translation', 'alternates', 'sense'], verdicts: ['ok', 'drop'] }
const csv = formatCsv([
  ['key', 'verdict', 'translation', 'alternates', 'sense', 'headword', 'note'],
  ['bank-1', '', 'банка', '', 'финансова институция', 'bank', ''],
  ['bank-2', '', 'банка', '', '', 'bank', 'old note'],
])

describe('applyDecisions', () => {
  it('writes cells, verdict and note for each decision, and leaves other rows alone', () => {
    const out = applyDecisions(csv, rules, [
      { key: 'bank-2', action: 'accept', cells: { translation: 'бряг' }, note: '' },
      { key: 'bank-1', action: 'drop', note: 'duplicate' },
    ])
    const rows = csvRecords(out.text).rows
    expect(rows[0]).toMatchObject({ key: 'bank-1', verdict: 'drop', translation: 'банка', note: 'duplicate' })
    expect(rows[1]).toMatchObject({ key: 'bank-2', verdict: 'ok', translation: 'бряг', note: 'old note' })
    expect(out.applied).toEqual(['bank-2', 'bank-1'])
    expect(out.missing).toEqual([])
  })

  it('ignores cells outside the queue columns', () => {
    const out = applyDecisions(csv, rules, [{ key: 'bank-1', action: 'edit', cells: { headword: 'BANK', sense: 'пари' } }])
    expect(csvRecords(out.text).rows[0]).toMatchObject({ headword: 'bank', sense: 'пари', verdict: 'ok' })
  })

  it('reports keys with no row and returns the text unchanged when nothing applied', () => {
    const out = applyDecisions(csv, rules, [{ key: 'nope-1', action: 'keep' }])
    expect(out).toEqual({ text: csv, applied: [], missing: ['nope-1'] })
  })

  it('round-trips commas, quotes, newlines and Cyrillic exactly', () => {
    const tricky = 'а, "б"\nв'
    const out = applyDecisions(csv, rules, [{ key: 'bank-1', action: 'edit', cells: { alternates: tricky }, note: tricky }])
    const row = csvRecords(out.text).rows[0]!
    expect(row['alternates']).toBe(tricky)
    expect(row['note']).toBe(tricky)
  })
})

describe('invalidDecision', () => {
  it('refuses unknown actions and drop where the queue has none', () => {
    expect(invalidDecision(rules, 'keep')).toBeNull()
    expect(invalidDecision(rules, 'zap')).toMatch(/not accept, keep, edit or drop/)
    expect(invalidDecision({ columns: [], verdicts: ['ok'] }, 'drop')).toMatch(/no drop/)
  })
})
