import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostedApi } from '../hostedApi'
import { HostedApp } from './HostedApp'

afterEach(() => (cleanup(), vi.restoreAllMocks(), (window.location.hash = '')))

const me = { email: 'anna@example.com', name: 'Anna', role: 'reviewer' as const, languages: ['de' as const] }
const progress = { inScope: 2, decided: 0, changed: 0, submitted: 0, merged: 0, remaining: 2 }
const assignment = { id: 7, reviewer: me.email, reviewerName: 'Anna', queue: 'translation-de', files: '*' as const, flaggedOnly: true, createdAt: 't', closedAt: null, progress }
const row = (key: string, over = {}) => ({
  queue: 'translation-de', file: 'review/translation-de/a.csv', version: 'v', key, kind: 'translation' as const, cells: { translation: 'Ufer' }, fields: ['translation'],
  context: { level: 'A1' }, otherSenses: [], reports: '', ai: 'flagged' as const, severity: 'major' as const, objections: [], decided: null, stale: false, rowHash: `h-${key}`, decision: null, ...over,
})

/** Opens the translation-de assignment from the list: its row carries the queue's name, its button says Start. */
async function openAssignment() {
  const item = (await screen.findByTitle('translation-de')).closest('li')!
  expect(within(item).getByText('German translations · flagged rows')).toBeTruthy()
  fireEvent.click(within(item).getByRole('button', { name: 'Start' }))
}

describe('HostedApp', () => {
  it('lists my assignments and opens one', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2')], discarded: [] })
    render(<HostedApp me={me} />)
    await openAssignment()
    // The header shows "Back" alone; the button's name is the whole of it.
    const back = within(screen.getByRole('banner')).getByRole('button', { name: 'Back to my assignments' })
    expect(back.firstChild?.textContent).toBe('Back')
    expect(back.querySelector('.visually-hidden')?.textContent).toBe(' to my assignments')
    expect(await screen.findByRole('article', { name: 'Row bank-2' })).toBeTruthy()
    // the header says what is being reviewed, in plain words
    expect(within(screen.getByRole('banner')).getByText('German translations · flagged rows')).toBeTruthy()
    expect(within(screen.getByRole('banner')).getByText('Anna')).toBeTruthy()
  })

  it('says it is loading while the rows are on their way, not that nothing is left', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    let arrive: (r: { rows: ReturnType<typeof row>[]; discarded: string[] }) => void = () => {}
    vi.spyOn(hostedApi, 'rows').mockImplementation(() => new Promise((resolve) => (arrive = resolve)))
    render(<HostedApp me={me} />)
    await openAssignment()
    expect(await screen.findByText('Loading…')).toBeTruthy()
    expect(screen.queryByText('Nothing left to decide here.')).toBeNull()
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull()
    arrive({ rows: [row('bank-2')], discarded: [] })
    expect(await screen.findByRole('article', { name: 'Row bank-2' })).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  it('offers Try again when the rows cannot be loaded, not "nothing left" and Submit', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    const rows = vi.spyOn(hostedApi, 'rows').mockRejectedValue(new Error('no review data'))
    render(<HostedApp me={me} />)
    await openAssignment()
    const again = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByRole('status').textContent).toBe('no review data')
    expect(screen.queryByText('Nothing left to decide here.')).toBeNull()
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull()
    rows.mockResolvedValue({ rows: [row('bank-2')], discarded: [] })
    fireEvent.click(again)
    expect(await screen.findByRole('article', { name: 'Row bank-2' })).toBeTruthy()
    expect(rows).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('keeps the row list shut while a row is being edited', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2'), row('bank-3')], discarded: [] })
    render(<HostedApp me={me} />)
    await openAssignment()
    await screen.findByRole('article', { name: 'Row bank-2' })
    fireEvent.keyDown(window, { key: '3' })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'All rows' }).disabled).toBe(true)
    fireEvent.keyDown(window, { key: 'l' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'All rows' }).disabled).toBe(false)
  })

  it('shows one row at a time; L opens the row list and its filters narrow the rows', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2'), row('carbon-1', { context: { level: 'B2' } })], discarded: [] })
    render(<HostedApp me={me} />)
    await openAssignment()
    await screen.findByRole('article', { name: 'Row bank-2' })
    expect(screen.getByText('1 of 2')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Rows' })).toBeNull()
    fireEvent.keyDown(window, { key: 'l' })
    const list = within(screen.getByRole('list', { name: 'Rows' }))
    expect(list.getAllByRole('button').length).toBe(2)
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'B2' } })
    expect(list.getAllByRole('button').length).toBe(1)
    fireEvent.click(list.getByRole('button', { name: /carbon-1/ }))
    expect(screen.queryByRole('list', { name: 'Rows' })).toBeNull()
    expect(screen.getByRole('article', { name: 'Row carbon-1' })).toBeTruthy()
    expect(screen.getByText('1 of 1')).toBeTruthy()
  })

  it('moves on after a decision and, with every row decided, offers Submit and the way back', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    const decision = { action: 'keep' as const, cells: {}, note: '', submission: null, changed: false }
    const decidedRow = (key: string) => row(key, { decided: { verdict: 'ok', note: '' }, decision })
    const rows = vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2'), row('bank-3')], discarded: [] })
    vi.spyOn(hostedApi, 'decide').mockResolvedValue({ ok: true, version: 'h' })
    render(<HostedApp me={me} />)
    await openAssignment()
    await screen.findByRole('article', { name: 'Row bank-2' })
    rows.mockResolvedValue({ rows: [decidedRow('bank-2'), row('bank-3')], discarded: [] })
    fireEvent.keyDown(window, { key: '2' })
    expect(await screen.findByRole('article', { name: 'Row bank-3' })).toBeTruthy()
    expect(screen.getByText('2 of 2')).toBeTruthy()
    rows.mockResolvedValue({ rows: [decidedRow('bank-2'), decidedRow('bank-3')], discarded: [] })
    await waitFor(() => expect((screen.getByRole('button', { name: /Keep/ }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.keyDown(window, { key: '2' })
    expect(await screen.findByText('Nothing left to decide here.')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Submit 2 decisions/ }).length).toBe(1)
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Back to my assignments' }))
    expect(await screen.findByRole('region', { name: 'Your assignments' })).toBeTruthy()
  })

  it('decides with the row hash and submits', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    const rows = vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2'), row('bank-3')], discarded: [] })
    const decide = vi.spyOn(hostedApi, 'decide').mockResolvedValue({ ok: true, version: 'h-bank-2' })
    const submit = vi.spyOn(hostedApi, 'submit').mockResolvedValue({ pr: 12, url: 'https://github.com/x/pull/12', count: 1, leftOut: [] })
    render(<HostedApp me={me} />)
    await openAssignment()
    await screen.findByRole('article', { name: 'Row bank-2' })
    // the reload that follows the decision returns the decided row (set before the click: waitFor flushes that reload)
    rows.mockResolvedValue({ rows: [row('bank-2', { decided: { verdict: 'ok', note: '' }, decision: { action: 'keep', cells: {}, note: '', submission: null, changed: false } }), row('bank-3')], discarded: [] })
    fireEvent.click(screen.getByRole('button', { name: /Keep/ }))
    await waitFor(() => expect(decide).toHaveBeenCalledWith(expect.objectContaining({ assignment: 7, key: 'bank-2', rowHash: 'h-bank-2', action: 'keep' })))
    fireEvent.click(await screen.findByRole('button', { name: /Submit 1 decision/ }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith(7))
    expect(await screen.findByRole('link', { name: /pull request 12/i })).toBeTruthy()
  })

  it('gives each left-out row of a submit its own reason', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    const decision = { action: 'keep' as const, cells: {}, note: '', submission: null, changed: false }
    vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2', { decided: { verdict: 'ok', note: '' }, decision })], discarded: [] })
    vi.spyOn(hostedApi, 'submit').mockResolvedValue({ pr: 5, url: 'https://github.com/x/pull/5', count: 1, leftOut: [{ key: 'bank-3', reason: 'changed' }, { key: 'bank-4', reason: 'gone' }] })
    render(<HostedApp me={me} />)
    await openAssignment()
    fireEvent.click(await screen.findByRole('button', { name: /Submit 1 decision/ }))
    const status = await screen.findByRole('status')
    await waitFor(() => expect(status.textContent).toMatch(/bank-3 \(changed\)/))
    expect(status.textContent).toMatch(/bank-4 \(gone\)/)
  })

  it('says when a decided row changed and when decisions were discarded', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2', { decision: { action: 'keep', cells: {}, note: '', submission: null, changed: true } })], discarded: ['gone-1'] })
    render(<HostedApp me={me} />)
    await openAssignment()
    expect(await screen.findByText(/gone-1/)).toBeTruthy()
    expect(await screen.findByText(/Changed since you decided it/)).toBeTruthy()
  })

  it('keeps Submit disabled while a submit is in flight, so a double click sends one pull request', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    const decision = { action: 'keep' as const, cells: {}, note: '', submission: null, changed: false }
    vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2', { decided: { verdict: 'ok', note: '' }, decision })], discarded: [] })
    let finish: (r: { pr: number; url: string; count: number; leftOut: [] }) => void = () => {}
    const submit = vi.spyOn(hostedApi, 'submit').mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    render(<HostedApp me={me} />)
    await openAssignment()
    const button = await screen.findByRole('button', { name: /Submit 1 decision/ })
    fireEvent.click(button)
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true))
    fireEvent.click(button)
    finish({ pr: 3, url: 'https://github.com/x/pull/3', count: 1, leftOut: [] })
    expect(await screen.findByRole('link', { name: /pull request 3/i })).toBeTruthy()
    expect(submit).toHaveBeenCalledTimes(1)
  })

  describe('for an admin', () => {
    const admin = { ...me, role: 'admin' as const }
    const mockAdmin = () => {
      vi.spyOn(hostedApi, 'assignments').mockResolvedValue([])
      vi.spyOn(hostedApi.admin, 'snapshot').mockResolvedValue(null)
      vi.spyOn(hostedApi.admin, 'reviewers').mockResolvedValue([])
      vi.spyOn(hostedApi.admin, 'assignments').mockResolvedValue([])
      vi.spyOn(hostedApi.admin, 'submissions').mockResolvedValue([])
    }

    it('puts the admin tabs into the header, with My assignments as the way back', async () => {
      mockAdmin()
      render(<HostedApp me={admin} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Admin' }))
      const header = within(screen.getByRole('banner'))
      expect((await header.findAllByRole('tab')).length).toBe(4)
      expect(header.queryByRole('button', { name: 'Admin' })).toBeNull()
      fireEvent.click(header.getByRole('tab', { name: 'Reviewers' }))
      expect(window.location.hash).toBe('#reviewers')
      fireEvent.click(header.getByRole('button', { name: 'My assignments' }))
      expect(await screen.findByRole('region', { name: 'Your assignments' })).toBeTruthy()
      expect(screen.queryByRole('tab')).toBeNull()
      // the tab has gone from the address with the admin page
      expect(window.location.hash).toBe('')
    })

    it('opens on the admin tab in the address, so a reload stays put', async () => {
      mockAdmin()
      window.location.hash = '#submissions'
      render(<HostedApp me={admin} />)
      expect((await screen.findByRole('tab', { name: 'Submissions' })).getAttribute('aria-selected')).toBe('true')
    })

    it('does not open the admin page for a reviewer, whatever the address says', async () => {
      mockAdmin()
      window.location.hash = '#submissions'
      render(<HostedApp me={me} />)
      expect(await screen.findByRole('region', { name: 'Your assignments' })).toBeTruthy()
      expect(screen.queryByRole('tab')).toBeNull()
    })
  })
})
