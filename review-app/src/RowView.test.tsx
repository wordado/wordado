import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RowView } from '../server/types'
import { applyFixes, RowViewPanel } from './RowView'

afterEach(cleanup)

const row: RowView = {
  queue: 'translation-bg', file: 'review/translation-bg/2026-10-04-01.csv', version: 'v', key: 'hour-2', kind: 'translation',
  cells: { translation: 'работно време', alternates: 'часове', sense: 'определен период' }, fields: ['translation', 'alternates', 'sense'],
  context: { headword: 'hour', pos: 'noun', sense_en: 'specific time period', level: 'A2', example: 'The office hours are from nine to five.' },
  otherSenses: [{ key: 'hour-1', translation: 'час', sense_en: 'sixty minutes' }], reports: '', ai: 'flagged', severity: 'major',
  objections: [{ reviewer: 'flash', model: 'google/gemini-3.8-flash', field: 'translation', category: 'wrong-sense', severity: 'major', reason: 'hour means час', fix: 'час' }],
  decided: null,
}

describe('applyFixes', () => {
  it('applies ticked fixes only', () => {
    expect(applyFixes(row.cells, row.objections, new Set([0]))).toEqual({ ...row.cells, translation: 'час' })
    expect(applyFixes(row.cells, row.objections, new Set())).toEqual(row.cells)
  })
})

describe('RowViewPanel', () => {
  it('shows the sense, the other senses, the objection and its fix', () => {
    render(<RowViewPanel row={row} onDecide={() => {}} />)
    expect(screen.getByText('specific time period')).toBeTruthy()
    expect(screen.getByText(/hour-1/)).toBeTruthy()
    expect(screen.getByText('hour means час')).toBeTruthy()
  })
  it('accepts the fix with the button and with key 1, keeps with key 2', () => {
    const onDecide = vi.fn()
    render(<RowViewPanel row={row} onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: /Accept fix/ }))
    expect(onDecide).toHaveBeenLastCalledWith('accept', { ...row.cells, translation: 'час' }, '')
    fireEvent.keyDown(window, { key: '2' })
    expect(onDecide).toHaveBeenLastCalledWith('keep', row.cells, '')
  })
  it('has no Drop for a level row', () => {
    render(<RowViewPanel row={{ ...row, kind: 'level', queue: 'level', fields: ['level'], cells: { level: 'B1' }, objections: [] }} onDecide={() => {}} />)
    expect(screen.queryByRole('button', { name: /Drop/ })).toBeNull()
  })
})
