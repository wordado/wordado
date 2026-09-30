import { describe, expect, it } from 'vitest'
import { fixedReports, validateFixes, type FixesFile, type ReportRecord } from './fixes'

const fixes: FixesFile = {
  schema_version: 1,
  corpus_version: 3,
  fixes: [
    { word_id: 'c:bank-1', field: 'translation', fixed_in: 2 },
    { word_id: 'c:bank-1', field: 'translation', fixed_in: 3 },
    { word_id: 'c:go-1', field: 'audio', fixed_in: 3 },
  ],
}
const report = (key: string, wordId: string, field: ReportRecord['field'], packVersion: number): ReportRecord => ({ key, wordId, field, packVersion })

describe('validateFixes', () => {
  it('accepts the published shape, and refuses another schema or a malformed fix', () => {
    expect(validateFixes(fixes)).toEqual(fixes)
    expect(validateFixes({ ...fixes, schema_version: 2 })).toBeNull()
    expect(validateFixes({ ...fixes, fixes: [{ word_id: 'c:bank-1', field: 'other', fixed_in: 2 }] })).toBeNull()
    expect(validateFixes({ ...fixes, fixes: [{ word_id: 'bank-1', field: 'audio', fixed_in: 2 }] })).toBeNull()
    expect(validateFixes({ ...fixes, fixes: [{ word_id: 'c:bank-1', field: 'audio', fixed_in: 0 }] })).toBeNull()
    expect(validateFixes([])).toBeNull()
  })
})

describe('fixedReports', () => {
  it('matches a report to the first fix of its word and field that came after it and is installed', () => {
    const r = report('k1', 'c:bank-1', 'translation', 1)
    expect(fixedReports([r], fixes, 3)).toEqual([{ report: r, fix: fixes.fixes[0] }])
  })

  it('never announces a fix older than the report, or one the learner has not installed yet', () => {
    expect(fixedReports([report('k1', 'c:bank-1', 'translation', 3)], fixes, 3)).toEqual([])
    expect(fixedReports([report('k2', 'c:go-1', 'audio', 1)], fixes, 2)).toEqual([])
    expect(fixedReports([report('k2', 'c:go-1', 'audio', 1)], fixes, null)).toEqual([])
  })

  it('never matches another field, another word, or an "other" report', () => {
    expect(fixedReports([report('k3', 'c:bank-1', 'audio', 1), report('k4', 'c:river-1', 'translation', 1), report('k5', 'c:bank-1', 'other', 1)], fixes, 3)).toEqual([])
  })
})
