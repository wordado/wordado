import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostedApi } from '../hostedApi'
import { HostedApp } from './HostedApp'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

const me = { email: 'anna@example.com', name: 'Anna', role: 'reviewer' as const, languages: ['de' as const] }
const progress = { inScope: 2, decided: 0, changed: 0, submitted: 0, merged: 0, remaining: 2 }
const assignment = { id: 7, reviewer: me.email, reviewerName: 'Anna', queue: 'translation-de', files: '*' as const, flaggedOnly: true, createdAt: 't', closedAt: null, progress }
const row = (key: string, over = {}) => ({
  queue: 'translation-de', file: 'review/translation-de/a.csv', version: 'v', key, kind: 'translation' as const, cells: { translation: 'Ufer' }, fields: ['translation'],
  context: { level: 'A1' }, otherSenses: [], reports: '', ai: 'flagged' as const, severity: 'major' as const, objections: [], decided: null, stale: false, rowHash: `h-${key}`, decision: null, ...over,
})

describe('HostedApp', () => {
  it('lists my assignments and opens one', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2')], discarded: [] })
    render(<HostedApp me={me} />)
    fireEvent.click(await screen.findByRole('button', { name: /translation-de/ }))
    expect(await screen.findByRole('article', { name: 'Row bank-2' })).toBeTruthy()
  })

  it('decides with the row hash and submits', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    const rows = vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2'), row('bank-3')], discarded: [] })
    const decide = vi.spyOn(hostedApi, 'decide').mockResolvedValue({ ok: true, version: 'h-bank-2' })
    const submit = vi.spyOn(hostedApi, 'submit').mockResolvedValue({ pr: 12, url: 'https://github.com/x/pull/12', count: 1, leftOut: [] })
    render(<HostedApp me={me} />)
    fireEvent.click(await screen.findByRole('button', { name: /translation-de/ }))
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
    fireEvent.click(await screen.findByRole('button', { name: /translation-de/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Submit 1 decision/ }))
    const status = await screen.findByRole('status')
    await waitFor(() => expect(status.textContent).toMatch(/bank-3 \(changed\)/))
    expect(status.textContent).toMatch(/bank-4 \(gone\)/)
  })

  it('says when a decided row changed and when decisions were discarded', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2', { decision: { action: 'keep', cells: {}, note: '', submission: null, changed: true } })], discarded: ['gone-1'] })
    render(<HostedApp me={me} />)
    fireEvent.click(await screen.findByRole('button', { name: /translation-de/ }))
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
    fireEvent.click(await screen.findByRole('button', { name: /translation-de/ }))
    const button = await screen.findByRole('button', { name: /Submit 1 decision/ })
    fireEvent.click(button)
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true))
    fireEvent.click(button)
    finish({ pr: 3, url: 'https://github.com/x/pull/3', count: 1, leftOut: [] })
    expect(await screen.findByRole('link', { name: /pull request 3/i })).toBeTruthy()
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
