import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hostedApi } from '../hostedApi'
import { Admin } from './Admin'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

// happy-dom has no window.confirm; give it one so the test can spy on it
window.confirm ??= () => false

const snapshot = {
  id: 'abc-1', built: '2026-10-05T10:00:00Z', commit: 'abcdef1',
  queues: [{ queue: 'translation-de', language: 'de' as const, files: [
    { file: 'review/translation-de/a.csv', rows: 200, flagged: 9, reported: 0, assignedTo: null },
    { file: 'review/translation-de/b.csv', rows: 180, flagged: 4, reported: 1, assignedTo: 'Hans' },
  ] }],
}
const anna = { email: 'anna@example.com', name: 'Anna', role: 'reviewer' as const, languages: ['de' as const], invitedAt: 't', inviteSentAt: null, disabledAt: null }

beforeEach(() => {
  vi.spyOn(hostedApi.admin, 'snapshot').mockResolvedValue(snapshot)
  vi.spyOn(hostedApi.admin, 'reviewers').mockResolvedValue([anna])
  vi.spyOn(hostedApi.admin, 'assignments').mockResolvedValue([])
  vi.spyOn(hostedApi.admin, 'submissions').mockResolvedValue([])
})

describe('Admin', () => {
  it('shows the snapshot and who holds each file', async () => {
    render(<Admin />)
    expect(await screen.findByText(/abcdef1/)).toBeTruthy()
    expect(await screen.findByText(/Hans/)).toBeTruthy()
  })

  it('invites a reviewer and shows the link when the mail failed', async () => {
    const invite = vi.spyOn(hostedApi.admin, 'invite').mockResolvedValue({ reviewer: { ...anna, email: 'b@example.com', name: 'B' }, inviteSent: false, link: 'https://review.wordado.com' })
    render(<Admin />)
    const form = await screen.findByRole('form', { name: 'Invite a reviewer' })
    fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'b@example.com' } })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'B' } })
    fireEvent.click(within(form).getByLabelText('German'))
    fireEvent.click(within(form).getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(invite).toHaveBeenCalledWith({ email: 'b@example.com', name: 'B', languages: ['de'], role: 'reviewer' }))
    expect(await screen.findByText(/invite not sent/i)).toBeTruthy()
    expect(screen.getByText('https://review.wordado.com')).toBeTruthy()
  })

  it('assigns free files of a queue in the reviewer’s language', async () => {
    const assign = vi.spyOn(hostedApi.admin, 'assign').mockResolvedValue({ id: 1, reviewer: anna.email, reviewerName: 'Anna', queue: 'translation-de', files: ['review/translation-de/a.csv'], flaggedOnly: false, createdAt: 't', closedAt: null, progress: null })
    render(<Admin />)
    const form = await screen.findByRole('form', { name: 'Assign' })
    fireEvent.change(within(form).getByLabelText('Reviewer'), { target: { value: anna.email } })
    fireEvent.change(within(form).getByLabelText('Queue'), { target: { value: 'translation-de' } })
    expect(within(form).getByLabelText(/b\.csv/).hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(form).getByLabelText(/a\.csv/))
    fireEvent.click(within(form).getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith({ reviewer: anna.email, queue: 'translation-de', files: ['review/translation-de/a.csv'], flaggedOnly: false }))
  })

  it('proposes a split and confirms it', async () => {
    vi.spyOn(hostedApi.admin, 'reviewers').mockResolvedValue([anna, { ...anna, email: 'hans@example.com', name: 'Hans' }])
    const split = vi.spyOn(hostedApi.admin, 'split')
      .mockResolvedValueOnce({ proposal: [{ reviewer: anna.email, files: ['review/translation-de/a.csv'], rows: 200 }, { reviewer: 'hans@example.com', files: ['review/translation-de/c.csv'], rows: 190 }] })
      .mockResolvedValueOnce({ assignments: [] })
    render(<Admin />)
    const form = await screen.findByRole('form', { name: 'Split a queue' })
    fireEvent.change(within(form).getByLabelText('Queue'), { target: { value: 'translation-de' } })
    fireEvent.click(within(form).getByLabelText('Anna'))
    fireEvent.click(within(form).getByLabelText('Hans'))
    fireEvent.click(within(form).getByRole('button', { name: 'Propose' }))
    expect(await within(form).findByText(/200 rows/)).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Create these assignments' }))
    await waitFor(() => expect(split).toHaveBeenLastCalledWith(expect.objectContaining({ confirm: true, proposal: expect.any(Array) })))
  })

  it('reassigns a closed assignment so its unsubmitted decisions are not stranded', async () => {
    const closedOne = { id: 7, reviewer: anna.email, reviewerName: 'Anna', queue: 'translation-de', files: '*' as const, flaggedOnly: false, createdAt: 't', closedAt: '2026-10-05T11:00:00Z', progress: { inScope: 13, decided: 3, changed: 0, submitted: 0, merged: 0, remaining: 10 } }
    vi.spyOn(hostedApi.admin, 'assignments').mockResolvedValue([closedOne])
    vi.spyOn(hostedApi.admin, 'reviewers').mockResolvedValue([anna, { ...anna, email: 'hans@example.com', name: 'Hans' }])
    const reassign = vi.spyOn(hostedApi.admin, 'reassign').mockResolvedValue({ ...closedOne, id: 8, reviewer: 'hans@example.com', reviewerName: 'Hans', closedAt: null })
    render(<Admin />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reassign…' }))
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Reassign to'), { target: { value: 'hans@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }))
    await waitFor(() => expect(reassign).toHaveBeenCalledWith(7, 'hans@example.com', 'move'))
  })

  it('disables a reviewer after confirming', async () => {
    const patch = vi.spyOn(hostedApi.admin, 'patchReviewer').mockResolvedValue({ ...anna, disabledAt: 't' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Admin />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disable Anna' }))
    await waitFor(() => expect(patch).toHaveBeenCalledWith(anna.email, { disabled: true }))
  })
})
