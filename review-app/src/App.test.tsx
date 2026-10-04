import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { api } from './api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App', () => {
  it('filters the list by level and severity', async () => {
    const base = { queue: 'translation-bg', file: 'f', version: 'v', kind: 'translation' as const, cells: {}, fields: [], otherSenses: [], ai: 'flagged' as const, objections: [], decided: null }
    vi.spyOn(api, 'reviewer').mockResolvedValue('Tester')
    vi.spyOn(api, 'queues').mockResolvedValue([{ queue: 'translation-bg', open: 2, flagged: 2, reported: 0, decided: 0 }])
    vi.spyOn(api, 'rows').mockResolvedValue([
      { ...base, key: 'a-1', context: { level: 'A1' }, reports: '', severity: 'major' },
      { ...base, key: 'b-1', context: { level: 'B2' }, reports: '', severity: 'minor' },
    ])
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: /b-1/ })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'A1' } })
    expect(screen.queryByRole('button', { name: /b-1/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'minor' } })
    expect(screen.queryByRole('button', { name: /a-1/ })).toBeNull()
  })

  it('asks for the reviewer name first, then lists the queues', async () => {
    vi.spyOn(api, 'reviewer').mockResolvedValue(null)
    vi.spyOn(api, 'queues').mockResolvedValue([{ queue: 'translation-bg', open: 3, flagged: 2, reported: 1, decided: 0 }])
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText(/Your name/)).toBeTruthy())
  })
})
