import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { api } from './api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const base = { queue: 'translation-bg', file: 'f', version: 'v', kind: 'translation' as const, cells: {}, fields: [], otherSenses: [], ai: 'flagged' as const, objections: [], decided: null, stale: false, rowHash: 'h' }
const a1 = { ...base, key: 'a-1', context: { level: 'A1' }, reports: '', severity: 'major' as const }
const b1 = { ...base, key: 'b-1', context: { level: 'B2' }, reports: '', severity: 'minor' as const }
/** A named reviewer with one queue of two flagged rows, a-1 (A1, major) and b-1 (B2, minor). */
function mockTwoRows() {
  vi.spyOn(api, 'reviewer').mockResolvedValue('Tester')
  vi.spyOn(api, 'queues').mockResolvedValue([{ queue: 'translation-bg', open: 2, flagged: 2, reported: 0, decided: 0 }])
  return vi.spyOn(api, 'rows').mockResolvedValue([a1, b1])
}

describe('App', () => {
  it('filters the list by level and severity', async () => {
    const base = { queue: 'translation-bg', file: 'f', version: 'v', kind: 'translation' as const, cells: {}, fields: [], otherSenses: [], ai: 'flagged' as const, objections: [], decided: null, stale: false, rowHash: 'h' }
    vi.spyOn(api, 'reviewer').mockResolvedValue('Tester')
    vi.spyOn(api, 'queues').mockResolvedValue([{ queue: 'translation-bg', open: 2, flagged: 2, reported: 0, decided: 0 }])
    vi.spyOn(api, 'rows').mockResolvedValue([
      { ...base, key: 'a-1', context: { level: 'A1' }, reports: '', severity: 'major' },
      { ...base, key: 'b-1', context: { level: 'B2' }, reports: '', severity: 'minor' },
    ])
    render(<App />)
    await waitFor(() => expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy())
    // the list is behind All rows now
    expect(screen.queryByRole('list', { name: 'Rows' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'All rows' }))
    const list = within(screen.getByRole('list', { name: 'Rows' }))
    expect(list.getByRole('button', { name: /b-1/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'A1' } })
    expect(list.queryByRole('button', { name: /b-1/ })).toBeNull()
    expect(list.getByRole('button', { name: /a-1/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'minor' } })
    expect(list.queryByRole('button', { name: /a-1/ })).toBeNull()
    // the card follows the filter: the row that is left is the one shown, as 1 of 1
    expect(screen.getByRole('article', { name: 'Row b-1' })).toBeTruthy()
    expect(screen.getByText('1 of 1')).toBeTruthy()
  })

  it('says it is loading until the first rows are there, not that nothing is left', async () => {
    vi.spyOn(api, 'reviewer').mockResolvedValue('Tester')
    vi.spyOn(api, 'queues').mockResolvedValue([{ queue: 'translation-bg', open: 2, flagged: 2, reported: 0, decided: 0 }])
    let arrive: (rows: (typeof a1)[]) => void = () => {}
    vi.spyOn(api, 'rows').mockImplementation(() => new Promise((resolve) => (arrive = resolve)))
    render(<App />)
    expect(await screen.findByRole('button', { name: 'All rows' })).toBeTruthy()
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText('Nothing left to decide here.')).toBeNull()
    arrive([a1])
    expect(await screen.findByRole('article', { name: 'Row a-1' })).toBeTruthy()
  })

  it('says nothing is left when there is no queue at all', async () => {
    vi.spyOn(api, 'reviewer').mockResolvedValue('Tester')
    vi.spyOn(api, 'queues').mockResolvedValue([])
    render(<App />)
    expect(await screen.findByText('Nothing left to decide here.')).toBeTruthy()
  })

  it('shows one row at a time with its place, and L opens the row list, which closes on choosing a row', async () => {
    mockTwoRows()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy())
    expect(screen.getAllByRole('article').length).toBe(1)
    expect(screen.getByText('1 of 2')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'l' })
    fireEvent.click(within(screen.getByRole('list', { name: 'Rows' })).getByRole('button', { name: /b-1/ }))
    expect(screen.queryByRole('list', { name: 'Rows' })).toBeNull()
    expect(screen.getByRole('article', { name: 'Row b-1' })).toBeTruthy()
    expect(screen.getByText('2 of 2')).toBeTruthy()
  })

  it('leaves the keys alone while the row list is open', async () => {
    mockTwoRows()
    const decide = vi.spyOn(api, 'decide')
    render(<App />)
    await waitFor(() => expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy())
    fireEvent.keyDown(window, { key: 'L' })
    expect(screen.getByRole('list', { name: 'Rows' })).toBeTruthy()
    fireEvent.keyDown(window, { key: '2' })
    fireEvent.keyDown(window, { key: 's' })
    expect(decide).not.toHaveBeenCalled()
    expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('list', { name: 'Rows' })).toBeNull()
  })

  it('does not open the row list or skip while typing a note', async () => {
    mockTwoRows()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Add a note' }))
    for (const key of ['l', 'L', 's', 'S', 'ArrowDown']) fireEvent.keyDown(screen.getByLabelText('Note for the coordinator'), { key })
    expect(screen.queryByRole('list', { name: 'Rows' })).toBeNull()
    expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy()
  })

  it('moves to the next undecided row after a decision, and says so when nothing is left', async () => {
    const rows = mockTwoRows()
    const decide = vi.spyOn(api, 'decide').mockResolvedValue({ ok: true, version: 'v' })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy())
    rows.mockResolvedValue([{ ...a1, decided: { verdict: 'ok', note: '' } }, b1])
    fireEvent.keyDown(window, { key: '2' })
    await waitFor(() => expect(screen.getByRole('article', { name: 'Row b-1' })).toBeTruthy())
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ key: 'a-1', action: 'keep' }))
    rows.mockResolvedValue([{ ...a1, decided: { verdict: 'ok', note: '' } }, { ...b1, decided: { verdict: 'ok', note: '' } }])
    await waitFor(() => expect((screen.getByRole('button', { name: /Keep/ }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: /Keep/ }))
    expect(await screen.findByText('Nothing left to decide here.')).toBeTruthy()
    expect(screen.queryByRole('article')).toBeNull()
    // Import decisions is offered there, once
    expect(screen.getAllByRole('button', { name: 'Import decisions' }).length).toBe(1)
    // a decided row can still be opened from the list
    fireEvent.click(screen.getByRole('button', { name: 'All rows' }))
    fireEvent.click(within(screen.getByRole('list', { name: 'Rows' })).getByRole('button', { name: /a-1/ }))
    expect(within(screen.getByRole('article', { name: 'Row a-1' })).getByText('decided: ok')).toBeTruthy()
  })

  it('shows the done state when every row is already decided', async () => {
    const rows = mockTwoRows()
    rows.mockResolvedValue([{ ...a1, decided: { verdict: 'ok', note: '' } }])
    render(<App />)
    expect(await screen.findByText('Nothing left to decide here.')).toBeTruthy()
  })

  it('keeps the queue picker and show unflagged in the header', async () => {
    mockTwoRows()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy())
    const header = within(screen.getByRole('banner'))
    expect(header.getByLabelText('Queue')).toBeTruthy()
    expect(header.getByLabelText(/show unflagged/)).toBeTruthy()
    expect(header.getByRole('button', { name: 'All rows' })).toBeTruthy()
    expect(header.getByRole('button', { name: 'Import decisions' })).toBeTruthy()
    expect(header.getByText('Tester')).toBeTruthy()
  })

  it('skips to the next undecided row without deciding', async () => {
    const base = { queue: 'translation-bg', file: 'f', version: 'v', kind: 'translation' as const, cells: {}, fields: [], otherSenses: [], ai: 'flagged' as const, objections: [], decided: null, stale: false, rowHash: 'h' }
    vi.spyOn(api, 'reviewer').mockResolvedValue('Tester')
    vi.spyOn(api, 'queues').mockResolvedValue([{ queue: 'translation-bg', open: 2, flagged: 2, reported: 0, decided: 0 }])
    const decide = vi.spyOn(api, 'decide')
    vi.spyOn(api, 'rows').mockResolvedValue([
      { ...base, key: 'a-1', context: { level: 'A1' }, reports: '', severity: 'major' },
      { ...base, key: 'b-1', context: { level: 'B2' }, reports: '', severity: 'minor' },
    ])
    render(<App />)
    await waitFor(() => expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }))
    await waitFor(() => expect(screen.getByRole('article', { name: 'Row b-1' })).toBeTruthy())
    expect(decide).not.toHaveBeenCalled()
  })

  it('skips forward through every undecided row without bouncing back, and ArrowUp moves back', async () => {
    const base = { queue: 'translation-bg', file: 'f', version: 'v', kind: 'translation' as const, cells: {}, fields: [], otherSenses: [], ai: 'flagged' as const, objections: [], decided: null, stale: false, rowHash: 'h' }
    vi.spyOn(api, 'reviewer').mockResolvedValue('Tester')
    vi.spyOn(api, 'queues').mockResolvedValue([{ queue: 'translation-bg', open: 3, flagged: 3, reported: 0, decided: 0 }])
    vi.spyOn(api, 'rows').mockResolvedValue([
      { ...base, key: 'a-1', context: {}, reports: '', severity: 'major' },
      { ...base, key: 'b-1', context: {}, reports: '', severity: 'major' },
      { ...base, key: 'c-1', context: {}, reports: '', severity: 'major' },
    ])
    render(<App />)
    await waitFor(() => expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }))
    await waitFor(() => expect(screen.getByRole('article', { name: 'Row b-1' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }))
    await waitFor(() => expect(screen.getByRole('article', { name: 'Row c-1' })).toBeTruthy())
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    await waitFor(() => expect(screen.getByRole('article', { name: 'Row b-1' })).toBeTruthy())
  })

  it('asks for the reviewer name first, then lists the queues', async () => {
    vi.spyOn(api, 'reviewer').mockResolvedValue(null)
    vi.spyOn(api, 'queues').mockResolvedValue([{ queue: 'translation-bg', open: 3, flagged: 2, reported: 1, decided: 0 }])
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText(/Your name/)).toBeTruthy())
  })

  it('shows a failed rows load as a notice instead of crashing', async () => {
    vi.spyOn(api, 'reviewer').mockResolvedValue('Tester')
    vi.spyOn(api, 'queues').mockResolvedValue([{ queue: 'translation-bg', open: 1, flagged: 1, reported: 0, decided: 0 }])
    vi.spyOn(api, 'rows').mockRejectedValue(new Error('pipeline.json has no ai_review block'))
    render(<App />)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('pipeline.json has no ai_review block'))
  })

  it('shows a failed import as a notice instead of crashing ("Imported undefined")', async () => {
    vi.spyOn(api, 'reviewer').mockResolvedValue('Tester')
    vi.spyOn(api, 'queues').mockResolvedValue([{ queue: 'translation-bg', open: 0, flagged: 0, reported: 0, decided: 0 }])
    vi.spyOn(api, 'rows').mockResolvedValue([])
    vi.spyOn(api, 'importDecisions').mockRejectedValue(new Error('set your name first'))
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import decisions' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Import decisions' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('set your name first'))
  })
})
