import { describe, expect, it } from 'vitest'
import type { RowView } from '../server/types'
import { applyFixes, firstPerField, toggleTick } from './RowView'

const row: RowView = {
  queue: 'translation-bg', file: 'review/translation-bg/2026-10-04-01.csv', version: 'v', key: 'hour-2', kind: 'translation',
  cells: { translation: 'работно време', alternates: 'часове', sense: 'определен период' }, fields: ['translation', 'alternates', 'sense'],
  context: { headword: 'hour', pos: 'noun', sense_en: 'specific time period', level: 'A2', example: 'The office hours are from nine to five.' },
  otherSenses: [{ key: 'hour-1', translation: 'час', sense_en: 'sixty minutes' }], reports: '', ai: 'flagged', severity: 'major',
  objections: [{ reviewer: 'flash', model: 'google/gemini-3.8-flash', field: 'translation', category: 'wrong-sense', severity: 'major', reason: 'hour means час', fix: 'час' }],
  decided: null, stale: false, rowHash: 'h',
}

describe('applyFixes', () => {
  it('applies ticked fixes only', () => {
    expect(applyFixes(row.cells, row.objections, new Set([0]))).toEqual({ ...row.cells, translation: 'час' })
    expect(applyFixes(row.cells, row.objections, new Set())).toEqual(row.cells)
  })
})

describe('firstPerField', () => {
  it('starts with the first objection of each field ticked', () => {
    const o = row.objections[0]!
    expect([...firstPerField([o, { ...o, fix: 'друг' }, { ...o, field: 'sense' }])]).toEqual([0, 2])
    expect(firstPerField([]).size).toBe(0)
  })
})

describe('toggleTick', () => {
  it('keeps one tick per field', () => {
    const o = row.objections[0]!
    const three = [o, { ...o, fix: 'друг' }, { ...o, field: 'sense' }]
    expect([...toggleTick(three, new Set([0, 2]), 1)].sort()).toEqual([1, 2])
    expect([...toggleTick(three, new Set([0, 2]), 0)]).toEqual([2])
  })
})
