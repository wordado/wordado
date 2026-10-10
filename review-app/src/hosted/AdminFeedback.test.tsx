import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedbackList, FeedbackView } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { AdminFeedback } from './AdminFeedback'
import { dateOf } from './adminUtil'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

const item = (id: number, over: Partial<FeedbackView> = {}): FeedbackView => ({
  id,
  receivedAt: Date.parse('2026-10-05T09:00:00Z') + id * 60_000,
  kind: 'bug',
  message: `message ${id}`,
  contactEmail: '',
  signedIn: false,
  appVersion: 'B3kq9xZa',
  corpusVersion: 'bg 6',
  language: 'bg',
  screen: '/path',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
  state: 'new',
  note: '',
  markedAt: null,
  ai: null,
  ...over,
})
const page = (items: FeedbackView[], more: Partial<{ read: number; nextBefore: number | null }> = {}): FeedbackList => ({ connected: true, items, read: more.read ?? items.length, nextBefore: more.nextBefore ?? null })

const bug = item(2, { message: 'The path does not open.\nIt stays white.', contactEmail: 'ana@example.com', signedIn: true })
const idea = item(1, { kind: 'idea', message: 'A dark theme.', corpusVersion: '', state: 'seen', note: 'Asked the designer.', markedAt: '2026-10-05T12:00:00Z' })

const listed = (items: FeedbackView[] = [bug, idea]) => vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValue(page(items))
const cards = async () => within(await screen.findByRole('list', { name: 'Feedback' })).getAllByRole('listitem')
/** A promise and the two ways to settle it, for an answer that is still on its way. */
function pending<T>() {
  let resolve!: (v: T) => void
  let reject!: (err: Error) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

describe('AdminFeedback', () => {
  it('lists the messages newest first: kind, when, the message with its line breaks, the address, signed in or not', async () => {
    const feedback = listed()
    render(<AdminFeedback />)
    const [first, second] = await cards()
    expect(feedback).toHaveBeenCalledWith({ kind: '', state: 'open' })
    expect(screen.getByRole('heading', { level: 2, name: 'Feedback' })).toBeTruthy()
    expect(within(first!).getByRole('heading', { level: 3 }).textContent).toBe(`Bug${dateOf(new Date(bug.receivedAt).toISOString())}signed in`)
    expect(within(first!).getByRole('article').getAttribute('aria-labelledby')).toBe(within(first!).getByRole('heading', { level: 3 }).id)
    const message = within(first!).getByText(/The path does not open/)
    expect(message.textContent).toBe('The path does not open.\nIt stays white.')
    expect(message.className).toBe('feedback-message')
    expect(within(first!).getByText('ana@example.com')).toBeTruthy()
    expect(within(first!).getByRole('link', { name: 'Write a mail' }).getAttribute('href')).toBe('mailto:ana@example.com')
    expect(within(second!).getByRole('heading', { level: 3 }).textContent).toContain('Idea')
    expect(within(second!).getByText('not signed in')).toBeTruthy()
    expect(within(second!).queryByRole('link')).toBeNull()
    expect(screen.getByText('2 messages')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('keeps an address from adding anything to the mail link', async () => {
    listed([item(1, { contactEmail: 'ana@example.com?bcc=else@example.com&body=x' })])
    render(<AdminFeedback />)
    expect((await screen.findByRole('link', { name: 'Write a mail' })).getAttribute('href')).toBe('mailto:ana@example.com%3Fbcc%3Delse%40example.com%26body%3Dx')
  })

  it('folds the technical details away behind Details', async () => {
    listed()
    render(<AdminFeedback />)
    const [first, second] = await cards()
    const details = within(first!).getByText('Details').closest('details')!
    expect(details.open).toBe(false)
    const pairs = (el: Element) => [...el.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent])
    expect(pairs(details)).toEqual([
      ['App version', 'B3kq9xZa'],
      ['Word list version', 'bg 6'],
      ['Language', 'bg'],
      ['Screen', '/path'],
      ['Browser', 'Mozilla/5.0 (X11; Linux x86_64)'],
    ])
    expect(pairs(second!)[1]).toEqual(['Word list version', 'none'])
  })

  it('shows each message’s mark, and saves a state as soon as it is chosen, with the note as it was saved', async () => {
    listed()
    const answer = pending<{ id: number; state: 'done'; note: string; markedAt: string }>()
    const mark = vi.spyOn(hostedApi.admin, 'markFeedback').mockReturnValue(answer.promise)
    render(<AdminFeedback />)
    const [, second] = await cards()
    const state = within(second!).getByRole('combobox', { name: 'State' }) as HTMLSelectElement
    expect([...state.options].map((o) => o.textContent)).toEqual(['New', 'Looked at', 'Done', 'Not doing'])
    expect(state.value).toBe('seen')
    expect((within(second!).getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value).toBe('Asked the designer.')
    // A draft of the note is not saved with the state.
    fireEvent.change(within(second!).getByRole('textbox', { name: 'Note' }), { target: { value: 'half a thought' } })
    fireEvent.change(state, { target: { value: 'done' } })
    expect(await within(second!).findByText('Saving…')).toBeTruthy()
    expect(state.value).toBe('done')
    expect(state.getAttribute('aria-busy')).toBe('true')
    await waitFor(() => expect(mark).toHaveBeenCalledWith(1, { state: 'done', note: 'Asked the designer.' }))
    answer.resolve({ id: 1, state: 'done', note: 'Asked the designer.', markedAt: 't' })
    expect(await within(second!).findByText('Saved')).toBeTruthy()
    expect(within(second!).getByText('Saved').getAttribute('role')).toBe('status')
    expect(state.value).toBe('done')
    // It stays on the page until the list is read again, so a note can still be written.
    expect((await cards()).length).toBe(2)
    expect((within(second!).getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value).toBe('half a thought')
  })

  it('puts the state back and says so when the save fails', async () => {
    listed()
    vi.spyOn(hostedApi.admin, 'markFeedback').mockRejectedValue(new Error('internal error'))
    render(<AdminFeedback />)
    const [first] = await cards()
    const state = within(first!).getByRole('combobox', { name: 'State' }) as HTMLSelectElement
    fireEvent.change(state, { target: { value: 'declined' } })
    expect(state.value).toBe('declined')
    const said = await within(first!).findByText('State not saved: internal error')
    expect(said.getAttribute('role')).toBe('status')
    expect(state.value).toBe('new')
    expect(state.getAttribute('aria-busy')).toBe('false')
  })

  it('saves the note on Save note, with the state as it is, and keeps what was typed when that fails', async () => {
    listed()
    const mark = vi.spyOn(hostedApi.admin, 'markFeedback').mockRejectedValueOnce(new Error('internal error'))
    render(<AdminFeedback />)
    const [first, second] = await cards()
    const note = within(second!).getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement
    const save = within(second!).getByRole('button', { name: 'Save note' }) as HTMLButtonElement
    expect(note.maxLength).toBe(2000)
    // Nothing to save until the note differs.
    expect(save.disabled).toBe(true)
    fireEvent.change(note, { target: { value: ' Shipped in the next version. ' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    expect(await within(second!).findByText('Note not saved: internal error')).toBeTruthy()
    expect(note.value).toBe(' Shipped in the next version. ')
    expect(save.disabled).toBe(false)
    mark.mockImplementation(async (id, m) => ({ id, ...m, markedAt: 't' }))
    fireEvent.submit(within(second!).getByRole('form', { name: 'Your mark' }))
    expect(await within(second!).findByText('Saved')).toBeTruthy()
    expect(mark).toHaveBeenLastCalledWith(1, { state: 'seen', note: 'Shipped in the next version.' })
    await waitFor(() => expect(save.disabled).toBe(true))
    // The state chosen next goes with the note just saved.
    fireEvent.change(within(second!).getByRole('combobox', { name: 'State' }), { target: { value: 'done' } })
    await waitFor(() => expect(mark).toHaveBeenLastCalledWith(1, { state: 'done', note: 'Shipped in the next version.' }))
    expect(within(first!).queryByText('Saved')).toBeNull()
  })

  it('sends the saves of one message one after another, each on top of the last answer', async () => {
    listed([bug])
    const first = pending<{ id: number; state: 'seen'; note: string; markedAt: string }>()
    const mark = vi.spyOn(hostedApi.admin, 'markFeedback').mockReturnValueOnce(first.promise).mockImplementation(async (id, m) => ({ id, ...m, markedAt: 't' }))
    render(<AdminFeedback />)
    const [card] = await cards()
    fireEvent.change(within(card!).getByRole('combobox', { name: 'State' }), { target: { value: 'seen' } })
    fireEvent.change(within(card!).getByRole('textbox', { name: 'Note' }), { target: { value: 'Looking.' } })
    fireEvent.click(within(card!).getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(mark).toHaveBeenCalledTimes(1))
    first.resolve({ id: 2, state: 'seen', note: '', markedAt: 't' })
    await waitFor(() => expect(mark).toHaveBeenCalledTimes(2))
    expect(mark).toHaveBeenLastCalledWith(2, { state: 'seen', note: 'Looking.' })
  })

  it('filters by kind and by state, Open first, reading the list again each time', async () => {
    const feedback = listed()
    render(<AdminFeedback />)
    await cards()
    const kind = screen.getByRole('combobox', { name: 'Kind' }) as HTMLSelectElement
    const show = screen.getByRole('combobox', { name: 'Show' }) as HTMLSelectElement
    expect([...kind.options].map((o) => o.textContent)).toEqual(['All', 'Bug', 'Idea', 'Other'])
    expect([...show.options].map((o) => o.textContent)).toEqual(['Open', 'All', 'Done', 'Not doing'])
    expect(show.value).toBe('open')
    feedback.mockResolvedValue(page([idea], { read: 2 }))
    fireEvent.change(kind, { target: { value: 'idea' } })
    await waitFor(() => expect(feedback).toHaveBeenLastCalledWith({ kind: 'idea', state: 'open' }))
    await waitFor(async () => expect((await cards()).length).toBe(1))
    expect(screen.getByText('1 message of 2 read')).toBeTruthy()
    fireEvent.change(show, { target: { value: 'declined' } })
    await waitFor(() => expect(feedback).toHaveBeenLastCalledWith({ kind: 'idea', state: 'declined' }))
  })

  it('shows only the answer to the filter chosen last', async () => {
    const slow = pending<FeedbackList>()
    const feedback = vi.spyOn(hostedApi.admin, 'feedback').mockReturnValueOnce(slow.promise).mockResolvedValue(page([idea]))
    render(<AdminFeedback />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind' }), { target: { value: 'idea' } })
    expect((await cards()).length).toBe(1)
    slow.resolve(page([bug, idea]))
    await waitFor(() => expect(feedback).toHaveBeenCalledTimes(2))
    expect((await cards()).length).toBe(1)
  })

  it('shows the busy bar while it reads, and loads the older messages under the ones it has', async () => {
    const first = pending<FeedbackList>()
    const older = pending<FeedbackList>()
    const feedback = vi.spyOn(hostedApi.admin, 'feedback').mockReturnValueOnce(first.promise).mockReturnValueOnce(older.promise)
    render(<AdminFeedback />)
    expect(screen.getByRole('progressbar', { name: 'Loading feedback' }).className).toBe('busy-bar')
    first.resolve(page([bug], { nextBefore: 2 }))
    const more = (await screen.findByRole('button', { name: 'Load more' })) as HTMLButtonElement
    expect(screen.queryByRole('progressbar')).toBeNull()
    fireEvent.click(more)
    expect(feedback).toHaveBeenLastCalledWith({ kind: '', state: 'open', before: 2 })
    expect(screen.getByRole('progressbar', { name: 'Loading feedback' })).toBeTruthy()
    expect(more.disabled).toBe(true)
    // What is already there stays while the older ones are on their way.
    expect((await cards()).length).toBe(1)
    older.resolve(page([idea]))
    await waitFor(async () => expect((await cards()).length).toBe(2))
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    expect(screen.getByText('2 messages')).toBeTruthy()
  })

  it('keeps Load more when the filter leaves a page empty, so the older messages can still be reached', async () => {
    const feedback = vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValueOnce(page([], { read: 50, nextBefore: 7 })).mockResolvedValueOnce(page([idea], { read: 3 }))
    render(<AdminFeedback />)
    expect(await screen.findByText('Nothing to show among the newest 50 messages.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect((await cards()).length).toBe(1)
    expect(feedback).toHaveBeenLastCalledWith({ kind: '', state: 'open', before: 7 })
    expect(screen.getByText('1 message of 53 read')).toBeTruthy()
  })

  it('keeps the messages it has when the older ones cannot be read, and offers to try again', async () => {
    const feedback = vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValueOnce(page([bug], { nextBefore: 2 })).mockRejectedValueOnce(new Error('The app’s server could not be reached.')).mockResolvedValueOnce(page([idea]))
    render(<AdminFeedback />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The older messages could not be read. The app’s server could not be reached.')
    expect((await cards()).length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(async () => expect((await cards()).length).toBe(2))
    expect(feedback).toHaveBeenLastCalledWith({ kind: '', state: 'open', before: 2 })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says in one sentence that feedback is not connected, naming the two settings', async () => {
    vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValue({ connected: false })
    render(<AdminFeedback />)
    expect((await screen.findByText(/Feedback is not connected/)).textContent).toBe('Feedback is not connected: set FEEDBACK_READ_TOKEN and LEARNER_APP_URL for the review app, then open this tab again.')
    expect(screen.queryByRole('list', { name: 'Feedback' })).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('says so when the server cannot be reached, and Try again reads it again', async () => {
    const feedback = vi.spyOn(hostedApi.admin, 'feedback').mockRejectedValueOnce(new Error('The app’s server could not be reached.')).mockResolvedValueOnce(page([bug]))
    render(<AdminFeedback />)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Feedback could not be read. The app’s server could not be reached.')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect((await cards()).length).toBe(1)
    expect(feedback).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says "No feedback yet." when there is none, and something else when the filter hides what there is', async () => {
    const feedback = vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValue(page([]))
    render(<AdminFeedback />)
    expect(await screen.findByText('No feedback yet.')).toBeTruthy()
    feedback.mockResolvedValue(page([], { read: 4 }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), { target: { value: 'done' } })
    expect(await screen.findByText('Nothing here to show.')).toBeTruthy()
    expect(screen.queryByText('No feedback yet.')).toBeNull()
  })
})
