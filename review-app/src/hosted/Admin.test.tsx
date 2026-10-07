import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hostedApi } from '../hostedApi'
import { Admin } from './Admin'

afterEach(() => (cleanup(), vi.restoreAllMocks(), (window.location.hash = '')))

// happy-dom has no window.confirm; give it one so the test can spy on it
window.confirm ??= () => false

const snapshot = {
  id: 'abc-1', built: '2026-10-05T10:00:00Z', commit: 'abcdef1',
  queues: [
    { queue: 'translation-de', language: 'de' as const, files: [
      { file: 'review/translation-de/a.csv', rows: 200, flagged: 9, reported: 0, assignedTo: null },
      { file: 'review/translation-de/b.csv', rows: 180, flagged: 4, reported: 1, assignedTo: 'Hans' },
    ] },
    { queue: 'title-es', language: 'es' as const, files: [{ file: 'review/title-es/a.csv', rows: 30, flagged: 1, reported: 0, assignedTo: null }] },
    { queue: 'translation-es', language: 'es' as const, files: [{ file: 'review/translation-es/a.csv', rows: 90, flagged: 4, reported: 0, assignedTo: null }] },
  ],
}
const anna = { email: 'anna@example.com', name: 'Anna', role: 'reviewer' as const, languages: ['de' as const], invitedAt: 't', inviteSentAt: null, disabledAt: null }
const carmen = { ...anna, email: 'carmen@example.com', name: 'Carmen', languages: ['es' as const], inviteSentAt: '2026-10-02T09:00:00Z' }
const annasGerman = { id: 3, reviewer: anna.email, reviewerName: 'Anna', queue: 'translation-de', files: '*' as const, flaggedOnly: true, createdAt: 't', closedAt: null, progress: { inScope: 14, decided: 3, changed: 0, submitted: 2, merged: 0, remaining: 9 } }
const submission = { id: 1, assignment: 3, reviewer: anna.email, reviewerName: 'Anna', queue: 'translation-de', branch: 'b', pr: 31, url: 'https://github.com/x/pull/31', count: 2, leftOut: 0, status: 'open' as const, createdAt: '2026-10-05T12:00:00Z' }

beforeEach(() => {
  vi.spyOn(hostedApi.admin, 'snapshot').mockResolvedValue(snapshot)
  vi.spyOn(hostedApi.admin, 'reviewers').mockResolvedValue([anna])
  vi.spyOn(hostedApi.admin, 'assignments').mockResolvedValue([])
  vi.spyOn(hostedApi.admin, 'submissions').mockResolvedValue([])
})

const openTab = async (name: string) => fireEvent.click(await screen.findByRole('tab', { name }))
/** Opens a tab, then the dialog behind one of its buttons; gives the dialog. */
async function openDialog(tab: string, button: string, title = button) {
  await openTab(tab)
  fireEvent.click(await screen.findByRole('button', { name: button }))
  return screen.getByRole('dialog', { name: title })
}

describe('Admin', () => {
  it('opens on the Overview: the four numbers, a row per language and what the review data was built from', async () => {
    vi.spyOn(hostedApi.admin, 'reviewers').mockResolvedValue([anna, carmen, { ...carmen, email: 'old@example.com', name: 'Old', disabledAt: 't' }])
    vi.spyOn(hostedApi.admin, 'assignments').mockResolvedValue([annasGerman])
    vi.spyOn(hostedApi.admin, 'submissions').mockResolvedValue([submission])
    render(<Admin />)
    expect((await screen.findByRole('tab', { name: 'Overview' })).getAttribute('aria-selected')).toBe('true')
    const panel = screen.getByRole('tabpanel', { name: 'Overview' })
    const tile = async (label: string) => (await within(panel).findByText(label)).closest('li')!.textContent
    expect(await tile('rows to decide')).toBe('19rows to decide')
    expect(await tile('decided, not submitted')).toBe('3decided, not submitted')
    expect(await tile('pull request open')).toBe('1pull request open')
    expect(await tile('active reviewers')).toBe('2active reviewers')
    const languages = within(within(panel).getByRole('list', { name: 'By language' })).getAllByRole('listitem')
    expect(languages.length).toBe(2)
    expect(within(languages[0]!).getByText('German')).toBeTruthy()
    expect(within(languages[0]!).getByText('14 translations · Anna')).toBeTruthy()
    expect(within(languages[0]!).getByText('on track')).toBeTruthy()
    expect(within(languages[1]!).getByText('Spanish')).toBeTruthy()
    expect(within(languages[1]!).getByText('4 translations · 1 title · nobody assigned')).toBeTruthy()
    expect(within(languages[1]!).getByRole('button', { name: 'Assign Spanish' })).toBeTruthy()
    expect(within(panel).getByText(/Review data built .* from commit abcdef1/)).toBeTruthy()
    // one tab at a time
    expect(screen.queryByRole('button', { name: 'Invite a reviewer' })).toBeNull()
  })

  it('says so when there is no review data yet', async () => {
    vi.spyOn(hostedApi.admin, 'snapshot').mockResolvedValue(null)
    render(<Admin />)
    expect(await screen.findByText(/No review data yet/)).toBeTruthy()
  })

  it('has four tabs; a click or the arrow keys change the tab, and it is kept in the address', async () => {
    render(<Admin />)
    const tablist = await screen.findByRole('tablist')
    expect(within(tablist).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Reviewers', 'Assignments', 'Submissions'])
    await openTab('Reviewers')
    expect(window.location.hash).toBe('#reviewers')
    expect(screen.getByRole('tab', { name: 'Reviewers' }).getAttribute('aria-selected')).toBe('true')
    const panel = screen.getByRole('tabpanel', { name: 'Reviewers' })
    expect(await within(panel).findByText('Anna')).toBeTruthy()
    expect(within(panel).getByText('anna@example.com')).toBeTruthy()
    expect(within(panel).getByText('invite not sent')).toBeTruthy()
    expect(screen.queryByRole('tabpanel', { name: 'Overview' })).toBeNull()

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Reviewers' }), { key: 'ArrowRight' })
    const assignments = screen.getByRole('tab', { name: 'Assignments' })
    expect(assignments.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(assignments)
    expect(assignments.tabIndex).toBe(0)
    expect(screen.getByRole('tab', { name: 'Reviewers' }).tabIndex).toBe(-1)
    expect(window.location.hash).toBe('#assignments')
    fireEvent.keyDown(assignments, { key: 'ArrowLeft' })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Reviewers' }), { key: 'ArrowLeft' })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Submissions' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Submissions' }), { key: 'Home' })
    expect(screen.getByRole('tabpanel', { name: 'Overview' })).toBeTruthy()
  })

  it('opens on the tab in the address, so a reload stays put', async () => {
    const first = render(<Admin />)
    await openTab('Submissions')
    first.unmount()
    render(<Admin />)
    expect((await screen.findByRole('tab', { name: 'Submissions' })).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel', { name: 'Submissions' })).toBeTruthy()
    // …and follows the address when it changes (the browser's Back)
    window.location.hash = '#reviewers'
    window.dispatchEvent(new Event('hashchange'))
    expect(await screen.findByRole('tabpanel', { name: 'Reviewers' })).toBeTruthy()
  })

  it('invites a reviewer from a dialog and shows the link when the mail failed', async () => {
    const invite = vi.spyOn(hostedApi.admin, 'invite').mockResolvedValue({ reviewer: { ...anna, email: 'b@example.com', name: 'B' }, inviteSent: false, link: 'https://review.wordado.com' })
    render(<Admin />)
    const dialog = await openDialog('Reviewers', 'Invite a reviewer')
    const form = within(dialog).getByRole('form', { name: 'Invite a reviewer' })
    fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'b@example.com' } })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'B' } })
    fireEvent.click(within(form).getByLabelText('German'))
    fireEvent.click(within(form).getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(invite).toHaveBeenCalledWith({ email: 'b@example.com', name: 'B', languages: ['de'], role: 'reviewer' }))
    expect(await screen.findByText(/Invite not sent: send this link yourself/)).toBeTruthy()
    expect(screen.getByText('https://review.wordado.com')).toBeTruthy()
    // the dialog has gone: the link is on the page
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('assigns free files of a queue in the reviewer’s language, and shows who holds the others', async () => {
    const assign = vi.spyOn(hostedApi.admin, 'assign').mockResolvedValue({ id: 1, reviewer: anna.email, reviewerName: 'Anna', queue: 'translation-de', files: ['review/translation-de/a.csv'], flaggedOnly: false, createdAt: 't', closedAt: null, progress: null })
    render(<Admin />)
    const dialog = await openDialog('Assignments', 'Assign work')
    const form = within(dialog).getByRole('form', { name: 'Assign' })
    fireEvent.change(within(form).getByLabelText('Reviewer'), { target: { value: anna.email } })
    fireEvent.change(within(form).getByLabelText('Queue'), { target: { value: 'translation-de' } })
    expect(within(form).getByLabelText(/b\.csv/).hasAttribute('disabled')).toBe(true)
    expect(within(form).getByLabelText(/b\.csv.*Hans/)).toBeTruthy()
    fireEvent.click(within(form).getByLabelText(/a\.csv/))
    fireEvent.click(within(form).getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith({ reviewer: anna.email, queue: 'translation-de', files: ['review/translation-de/a.csv'], flaggedOnly: false }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps the dialog open with the error in it when the server refuses, and says it once on the page', async () => {
    vi.spyOn(hostedApi.admin, 'assign').mockRejectedValue(new Error('a.csv is already assigned to Rita'))
    render(<Admin />)
    const dialog = await openDialog('Assignments', 'Assign work')
    const form = within(dialog).getByRole('form', { name: 'Assign' })
    fireEvent.change(within(form).getByLabelText('Reviewer'), { target: { value: anna.email } })
    fireEvent.change(within(form).getByLabelText('Queue'), { target: { value: 'translation-de' } })
    fireEvent.click(within(form).getByLabelText('All files'))
    fireEvent.click(within(form).getByRole('button', { name: 'Assign' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('a.csv is already assigned to Rita')
    expect(screen.getByRole('dialog', { name: 'Assign work' })).toBeTruthy()
    const notices = document.querySelectorAll('p.notice')
    expect(notices.length).toBe(1)
    expect(notices[0]!.textContent).toBe('a.csv is already assigned to Rita')
    expect(dialog.contains(notices[0]!)).toBe(false)
    // an error from one dialog is not shown in the next one
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Split a queue' }))
    expect(within(screen.getByRole('dialog', { name: 'Split a queue' })).queryByRole('alert')).toBeNull()
  })

  it('opens Assign from an unassigned language of the Overview with its translation queue chosen', async () => {
    vi.spyOn(hostedApi.admin, 'reviewers').mockResolvedValue([anna, carmen])
    const assign = vi.spyOn(hostedApi.admin, 'assign').mockResolvedValue({ ...annasGerman, id: 9 })
    render(<Admin />)
    fireEvent.click(await screen.findByRole('button', { name: 'Assign Spanish' }))
    expect(screen.getByRole('tab', { name: 'Assignments' }).getAttribute('aria-selected')).toBe('true')
    const form = within(screen.getByRole('dialog', { name: 'Assign work' })).getByRole('form', { name: 'Assign' })
    expect((within(form).getByLabelText('Queue') as HTMLSelectElement).value).toBe('translation-es')
    // the queue stays when the reviewer chosen has its language…
    fireEvent.change(within(form).getByLabelText('Reviewer'), { target: { value: carmen.email } })
    expect((within(form).getByLabelText('Queue') as HTMLSelectElement).value).toBe('translation-es')
    fireEvent.click(within(form).getByLabelText('All files'))
    fireEvent.click(within(form).getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith({ reviewer: carmen.email, queue: 'translation-es', files: '*', flaggedOnly: false }))
  })

  it('drops the chosen queue when the reviewer does not have its language', async () => {
    vi.spyOn(hostedApi.admin, 'reviewers').mockResolvedValue([anna, carmen])
    render(<Admin />)
    fireEvent.click(await screen.findByRole('button', { name: 'Assign Spanish' }))
    const form = within(screen.getByRole('dialog', { name: 'Assign work' })).getByRole('form', { name: 'Assign' })
    fireEvent.change(within(form).getByLabelText('Reviewer'), { target: { value: anna.email } })
    expect((within(form).getByLabelText('Queue') as HTMLSelectElement).value).toBe('')
    expect((within(form).getByRole('button', { name: 'Assign' }) as HTMLButtonElement).disabled).toBe(true)
    // Assign work, from the tab, starts empty
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Assign work' }))
    expect((screen.getByLabelText('Queue') as HTMLSelectElement).value).toBe('')
  })

  it('proposes a split in a dialog and confirms it', async () => {
    vi.spyOn(hostedApi.admin, 'reviewers').mockResolvedValue([anna, { ...anna, email: 'hans@example.com', name: 'Hans' }])
    const split = vi.spyOn(hostedApi.admin, 'split')
      .mockResolvedValueOnce({ proposal: [{ reviewer: anna.email, files: ['review/translation-de/a.csv'], rows: 200 }, { reviewer: 'hans@example.com', files: ['review/translation-de/c.csv'], rows: 190 }] })
      .mockResolvedValueOnce({ assignments: [] })
    render(<Admin />)
    const dialog = await openDialog('Assignments', 'Split a queue')
    const form = within(dialog).getByRole('form', { name: 'Split a queue' })
    fireEvent.change(within(form).getByLabelText('Queue'), { target: { value: 'translation-de' } })
    fireEvent.click(within(form).getByLabelText('Anna'))
    fireEvent.click(within(form).getByLabelText('Hans'))
    fireEvent.click(within(form).getByRole('button', { name: 'Propose' }))
    expect(await within(form).findByText(/200 rows/)).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Create these assignments' }))
    await waitFor(() => expect(split).toHaveBeenLastCalledWith(expect.objectContaining({ confirm: true, proposal: expect.any(Array) })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('lists an open assignment by its plain name, with who has it and how far it is', async () => {
    vi.spyOn(hostedApi.admin, 'assignments').mockResolvedValue([annasGerman])
    render(<Admin />)
    await openTab('Assignments')
    const row = (await screen.findByText('German translations · flagged rows')).closest('li')!
    expect(within(row).getByText('Anna · 14 rows · 3 decided · 2 submitted · 9 to go')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Reassign…' })).toBeTruthy()
  })

  it('reassigns a closed assignment so its unsubmitted decisions are not stranded', async () => {
    const closedOne = { id: 7, reviewer: anna.email, reviewerName: 'Anna', queue: 'translation-de', files: '*' as const, flaggedOnly: false, createdAt: 't', closedAt: '2026-10-05T11:00:00Z', progress: { inScope: 13, decided: 3, changed: 0, submitted: 0, merged: 0, remaining: 10 } }
    vi.spyOn(hostedApi.admin, 'assignments').mockResolvedValue([closedOne])
    vi.spyOn(hostedApi.admin, 'reviewers').mockResolvedValue([anna, { ...anna, email: 'hans@example.com', name: 'Hans' }])
    const reassign = vi.spyOn(hostedApi.admin, 'reassign').mockResolvedValue({ ...closedOne, id: 8, reviewer: 'hans@example.com', reviewerName: 'Hans', closedAt: null })
    render(<Admin />)
    await openTab('Assignments')
    const open = await screen.findByRole('button', { name: 'Reassign…' })
    // a closed assignment cannot be closed again (asked before the dialog, which has a Close of its own, opens)
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    fireEvent.click(open)
    const dialog = screen.getByRole('dialog', { name: 'Reassign' })
    fireEvent.change(within(dialog).getByLabelText('Reassign to'), { target: { value: 'hans@example.com' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reassign' }))
    await waitFor(() => expect(reassign).toHaveBeenCalledWith(7, 'hans@example.com', 'move'))
  })

  it('edits a reviewer’s languages in a dialog', async () => {
    const patch = vi.spyOn(hostedApi.admin, 'patchReviewer').mockResolvedValue({ ...anna, languages: ['de', 'es'] })
    render(<Admin />)
    await openTab('Reviewers')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Anna' }))
    const dialog = screen.getByRole('dialog', { name: 'Languages of Anna' })
    expect((within(dialog).getByLabelText('German') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(within(dialog).getByLabelText('Spanish'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(patch).toHaveBeenCalledWith(anna.email, { languages: ['de', 'es'] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('disables a reviewer after confirming', async () => {
    const patch = vi.spyOn(hostedApi.admin, 'patchReviewer').mockResolvedValue({ ...anna, disabledAt: 't' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Admin />)
    await openTab('Reviewers')
    fireEvent.click(await screen.findByRole('button', { name: 'Disable Anna' }))
    await waitFor(() => expect(patch).toHaveBeenCalledWith(anna.email, { disabled: true }))
  })

  it('drops the page notice when the tab changes', async () => {
    vi.spyOn(hostedApi.admin, 'patchReviewer').mockRejectedValue(new Error('the last admin cannot be disabled'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Admin />)
    await openTab('Reviewers')
    fireEvent.click(await screen.findByRole('button', { name: 'Disable Anna' }))
    expect((await screen.findByRole('status')).textContent).toBe('the last admin cannot be disabled')
    // choosing the tab that is shown changes nothing
    fireEvent.click(screen.getByRole('tab', { name: 'Reviewers' }))
    expect(screen.getByRole('status')).toBeTruthy()
    await openTab('Assignments')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('lists the submissions with the queue’s plain name, the state and the pull request', async () => {
    vi.spyOn(hostedApi.admin, 'submissions').mockResolvedValue([submission])
    render(<Admin />)
    await openTab('Submissions')
    const row = (await screen.findByText('Anna · German translations')).closest('li')!
    expect(within(row).getByText('open')).toBeTruthy()
    expect(within(row).getByRole('link', { name: 'pull request 31' }).getAttribute('href')).toBe('https://github.com/x/pull/31')
  })
})
