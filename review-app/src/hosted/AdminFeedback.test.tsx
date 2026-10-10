import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedbackAi, FeedbackAiRead, FeedbackAiStatus, FeedbackList, FeedbackView } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { AdminFeedback } from './AdminFeedback'
import { dateOf } from './adminUtil'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

const aiStatus = (over: Partial<FeedbackAiStatus> = {}): FeedbackAiStatus => ({ setUp: true, on: true, model: 'test/model', callsToday: 3, dailyCalls: 200, reads: ['en', 'bg'], ...over })
// Without the key, as a deployment is before the owner sets it: the tab is what it was before there was any AI help.
beforeEach(() => void vi.spyOn(hostedApi.admin, 'feedbackAi').mockResolvedValue(aiStatus({ setUp: false, on: false })))

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

const reading = (over: Partial<FeedbackAi> = {}): FeedbackAi => ({ language: 'en', translation: '', category: 'idea', severity: null, summary: 'Wants a dark theme.', ...over })
const german = item(7, { kind: 'other', language: 'de', message: 'Der Ton wird zweimal abgespielt.', ai: reading({ language: 'de', translation: 'The sound plays twice.', category: 'bug', severity: 'annoys', summary: 'The sound of a word plays twice.' }) })
const thanks = item(6, { kind: 'other', message: 'Благодаря за приложението!', ai: reading({ language: 'bg', category: 'praise', summary: 'Thanks for the app.' }) })
const advert = item(5, { kind: 'other', message: 'Cheap watches at example.com', ai: reading({ category: 'junk', summary: 'An advertisement.' }) })
const aiRead = (over: Partial<FeedbackAiRead> = {}): FeedbackAiRead => ({ results: {}, asked: 0, left: 0, why: null, ...over })
const aiOn = (over: Partial<FeedbackAiStatus> = {}) => vi.spyOn(hostedApi.admin, 'feedbackAi').mockResolvedValue(aiStatus(over))
const notes = () => screen.queryAllByRole('status').filter((el) => el.classList.contains('feedback-ai-note')).map((el) => el.textContent)

describe('AdminFeedback: what the AI reads in a message (spec 2026-10-10 §3.1)', () => {
  it('shows a translation under the original, marked as the AI’s, and leaves the original as it was written', async () => {
    listed([german, thanks])
    render(<AdminFeedback />)
    const [first, second] = await cards()
    const original = within(first!).getByText('Der Ton wird zweimal abgespielt.')
    expect(original.className).toBe('feedback-message')
    const translation = within(first!).getByText('The sound plays twice.')
    expect(translation.className).toBe('feedback-translation')
    expect(original.compareDocumentPosition(translation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(first!).getByText('Translation by the AI')).toBeTruthy()
    // Bulgarian is read as it is: no translation, and no empty block for one.
    expect(within(second!).queryByText('Translation by the AI')).toBeNull()
    expect(second!.querySelector('.feedback-translation')).toBeNull()
    expect(within(second!).getByText('Благодаря за приложението!')).toBeTruthy()
  })

  it('shows the AI’s category beside the learner’s own kind, a bug’s severity, and the summary', async () => {
    listed([german, thanks])
    render(<AdminFeedback />)
    const [first, second] = await cards()
    // The learner chose Other; the AI reads a bug. Both are there.
    expect(within(first!).getByRole('heading', { level: 3 }).textContent).toContain('Other')
    expect([...first!.querySelectorAll('.feedback-ai .chip')].map((el) => el.textContent)).toEqual(['AI: Bug', 'Annoys'])
    expect(first!.querySelector('.feedback-ai-summary')?.textContent).toBe('AI summary: The sound of a word plays twice.')
    expect([...second!.querySelectorAll('.feedback-ai .chip')].map((el) => el.textContent)).toEqual(['AI: Praise'])
    expect(second!.querySelector('.feedback-ai-summary')?.textContent).toBe('AI summary: Thanks for the app.')
  })

  it('names each severity in words', async () => {
    listed([item(3, { ai: reading({ category: 'bug', severity: 'blocks' }) }), item(2, { ai: reading({ category: 'bug', severity: 'cosmetic' }) }), item(1, { ai: reading({ category: 'question' }) })])
    render(<AdminFeedback />)
    expect((await cards()).map((card) => [...card.querySelectorAll('.feedback-ai .chip')].map((el) => el.textContent))).toEqual([['AI: Bug', 'Blocks study'], ['AI: Bug', 'Cosmetic'], ['AI: Question']])
  })

  it('shows nothing of the AI on a message it has not read', async () => {
    listed()
    render(<AdminFeedback />)
    const [first] = await cards()
    expect(first!.querySelector('.feedback-ai')).toBeNull()
    expect(first!.querySelector('.feedback-translation')).toBeNull()
    expect(first!.textContent).not.toContain('AI')
  })

  it('folds what the AI reads as junk away under Open, never out of reach, and lists it under All', async () => {
    const feedback = listed([german, thanks, advert])
    render(<AdminFeedback />)
    expect((await cards()).length).toBe(2)
    // The count is of the list; the fold says its own.
    expect(screen.getByText('2 messages of 3 read')).toBeTruthy()
    const fold = screen.getByText('1 message the AI reads as junk').closest('details')!
    expect(fold.className).toBe('feedback-junk')
    expect(fold.open).toBe(false)
    expect(within(fold).getByText('Cheap watches at example.com')).toBeTruthy()
    // Its mark is there as on any message.
    expect(within(fold).getByRole('combobox', { name: 'State' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), { target: { value: 'all' } })
    await waitFor(() => expect(feedback).toHaveBeenLastCalledWith({ kind: '', state: 'all' }))
    await waitFor(async () => expect((await cards()).length).toBe(3))
    expect(screen.queryByText(/the AI reads as junk/)).toBeNull()
  })

  it('still shows the fold when everything open is junk', async () => {
    listed([advert, item(4, { ai: reading({ category: 'junk' }) })])
    render(<AdminFeedback />)
    expect(await screen.findByText('2 messages the AI reads as junk')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Feedback' })).toBeNull()
    expect(screen.getByText('Nothing here to show.')).toBeTruthy()
  })
})

describe('AdminFeedback: asking the AI about a page', () => {
  it('asks once after the list is shown, by the page’s kind and cursor, and puts the results on the cards without reading the list again', async () => {
    aiOn()
    const feedback = listed([item(7, { kind: 'other', message: 'Der Ton wird zweimal abgespielt.' }), bug])
    const answer = pending<FeedbackAiRead>()
    const read = vi.spyOn(hostedApi.admin, 'readFeedbackAi').mockReturnValue(answer.promise)
    render(<AdminFeedback />)
    const [first, second] = await cards()
    // The messages are there at once; the AI's parts come when its answer does.
    expect(first!.querySelector('.feedback-ai')).toBeNull()
    await waitFor(() => expect(read).toHaveBeenCalledWith({ kind: '' }))
    expect(await screen.findByText('The AI is reading the new messages…')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
    fireEvent.change(within(first!).getByRole('textbox', { name: 'Note' }), { target: { value: 'half a thought' } })
    answer.resolve(aiRead({ results: { 7: german.ai! }, asked: 2, left: 0 }))
    expect(await within(first!).findByText('The sound plays twice.')).toBeTruthy()
    expect(first!.querySelector('.feedback-ai-summary')?.textContent).toBe('AI summary: The sound of a word plays twice.')
    expect(second!.querySelector('.feedback-ai')).toBeNull()
    expect(screen.queryByText('The AI is reading the new messages…')).toBeNull()
    // The card is the same one: what was typed in it is still there.
    expect((within(first!).getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value).toBe('half a thought')
    expect(feedback).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledTimes(1)
    expect(notes()).toEqual([])
    // One more call was made today.
    expect(screen.getByText('On: test/model. 4 of 200 calls used today.')).toBeTruthy()
  })

  it('does not ask while the AI help is off, not set up or out of reach', async () => {
    const read = vi.spyOn(hostedApi.admin, 'readFeedbackAi').mockResolvedValue(aiRead())
    for (const mock of [() => aiOn({ on: false }), () => aiOn({ setUp: false, on: true }), () => vi.spyOn(hostedApi.admin, 'feedbackAi').mockRejectedValue(new Error('internal error'))]) {
      mock()
      listed()
      render(<AdminFeedback />)
      expect((await cards()).length).toBe(2)
      await screen.findByText(/^(Off\. No message|AI help is not set up|AI help could not be reached)/)
      expect(read).not.toHaveBeenCalled()
      expect(notes()).toEqual([])
      expect(screen.queryByRole('alert')).toBeNull()
      cleanup()
    }
  })

  it('asks about the older page with that page’s cursor when Load more shows it', async () => {
    aiOn()
    vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValueOnce(page([german], { nextBefore: 7 })).mockResolvedValueOnce(page([item(4)]))
    const read = vi.spyOn(hostedApi.admin, 'readFeedbackAi').mockResolvedValueOnce(aiRead()).mockResolvedValueOnce(aiRead({ results: { 4: reading({ summary: 'An older idea.' }) }, asked: 1 }))
    render(<AdminFeedback />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(read.mock.calls).toEqual([[{ kind: '' }], [{ kind: '', before: 7 }]])
    expect(await screen.findByText('AI summary: An older idea.')).toBeTruthy()
    // The first page keeps what it had.
    expect(screen.getByText('The sound plays twice.')).toBeTruthy()
  })

  it('keeps a result that arrives while an older page is on its way', async () => {
    aiOn()
    const older = pending<FeedbackList>()
    vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValueOnce(page([item(7, { kind: 'other' })], { nextBefore: 7 })).mockReturnValueOnce(older.promise)
    const first = pending<FeedbackAiRead>()
    vi.spyOn(hostedApi.admin, 'readFeedbackAi').mockReturnValueOnce(first.promise).mockResolvedValue(aiRead())
    render(<AdminFeedback />)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    first.resolve(aiRead({ results: { 7: german.ai! }, asked: 1 }))
    expect(await screen.findByText('The sound plays twice.')).toBeTruthy()
    older.resolve(page([item(4)]))
    await waitFor(async () => expect((await cards()).length).toBe(2))
    expect(screen.getByText('The sound plays twice.')).toBeTruthy()
  })

  it.each([
    ['limit', 'Today’s limit of 200 AI calls is reached. Messages without AI results are read again tomorrow.'],
    ['unreachable', 'The AI gave no results this time (it could not be reached). Messages without them are asked again the next time the page is read.'],
    ['late', 'The AI gave no results this time (it took too long). Messages without them are asked again the next time the page is read.'],
    ['refused', 'The AI gave no results this time (the service refused the request). Messages without them are asked again the next time the page is read.'],
    ['unfit', 'The AI gave no results this time (its answer could not be used). Messages without them are asked again the next time the page is read.'],
  ] as const)('says once, not on each message, why the AI gave nothing: %s', async (why, said) => {
    aiOn()
    listed([item(3), item(2), item(1)])
    vi.spyOn(hostedApi.admin, 'readFeedbackAi').mockResolvedValue(aiRead({ asked: why === 'limit' ? 0 : 3, left: 3, why }))
    render(<AdminFeedback />)
    await waitFor(() => expect(notes()).toEqual([said]))
    const cardsNow = await cards()
    expect(cardsNow.length).toBe(3)
    for (const card of cardsNow) expect(card.textContent).not.toContain('AI')
    expect(screen.queryByRole('button', { name: 'Ask the AI' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says how many messages have no result yet, and Ask the AI asks about that page again', async () => {
    aiOn()
    listed([item(3), item(2), item(1)])
    const read = vi.spyOn(hostedApi.admin, 'readFeedbackAi').mockResolvedValueOnce(aiRead({ results: { 3: reading() }, asked: 1, left: 2 })).mockResolvedValueOnce(aiRead({ results: { 2: reading(), 1: reading() }, asked: 2, left: 0 }))
    render(<AdminFeedback />)
    await waitFor(() => expect(notes()).toEqual(['2 messages have no AI result yet.']))
    fireEvent.click(screen.getByRole('button', { name: 'Ask the AI' }))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(read).toHaveBeenLastCalledWith({ kind: '' })
    await waitFor(() => expect(document.querySelectorAll('.feedback-ai-summary').length).toBe(3))
    expect(notes()).toEqual([])
    expect(screen.queryByRole('button', { name: 'Ask the AI' })).toBeNull()
  })

  it('leaves the list as it is when the AI’s own call fails, and says so in its panel', async () => {
    aiOn()
    listed()
    vi.spyOn(hostedApi.admin, 'readFeedbackAi').mockRejectedValue(new Error('internal error'))
    render(<AdminFeedback />)
    expect((await cards()).length).toBe(2)
    expect(await screen.findByText('AI help could not be reached.')).toBeTruthy()
    expect((await cards()).length).toBe(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('2 messages')).toBeTruthy()
  })

  it('does not put the answer to an older filter on the messages of a newer one', async () => {
    aiOn()
    const feedback = vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValueOnce(page([item(7, { kind: 'other' })])).mockResolvedValue(page([item(7, { kind: 'other' }), item(2)]))
    const slow = pending<FeedbackAiRead>()
    const read = vi.spyOn(hostedApi.admin, 'readFeedbackAi').mockReturnValueOnce(slow.promise).mockResolvedValue(aiRead({ left: 2, asked: 0, why: 'limit' }))
    render(<AdminFeedback />)
    await cards()
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), { target: { value: 'all' } })
    await waitFor(() => expect(feedback).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(notes().length).toBe(1))
    slow.resolve(aiRead({ results: { 7: german.ai! }, asked: 1, left: 0 }))
    await new Promise((done) => setTimeout(done, 20))
    expect(screen.queryByText('The sound plays twice.')).toBeNull()
    expect(notes()).toEqual(['Today’s limit of 200 AI calls is reached. Messages without AI results are read again tomorrow.'])
  })

  it('reads the list again, and so asks the AI, when the help is switched on', async () => {
    aiOn({ on: false })
    const feedback = listed([item(7, { kind: 'other' })])
    vi.spyOn(hostedApi.admin, 'setFeedbackAi').mockResolvedValue(aiStatus({ on: true }))
    const read = vi.spyOn(hostedApi.admin, 'readFeedbackAi').mockResolvedValue(aiRead({ results: { 7: german.ai! }, asked: 1 }))
    render(<AdminFeedback />)
    await cards()
    fireEvent.click(await screen.findByRole('switch', { name: 'AI help' }))
    expect(await screen.findByText('The sound plays twice.')).toBeTruthy()
    expect(read).toHaveBeenCalledTimes(1)
    expect(feedback).toHaveBeenCalledTimes(2)
  })

  it('takes the AI’s parts off the cards when its results are forgotten, and leaves the marks', async () => {
    aiOn({ on: false })
    listed([german, { ...idea, ai: reading() }])
    vi.spyOn(hostedApi.admin, 'forgetFeedbackAi').mockResolvedValue({ forgotten: 2 })
    render(<AdminFeedback />)
    const [first, second] = await cards()
    expect(document.querySelectorAll('.feedback-ai').length).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Forget the AI’s results' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Forget them' }))
    await waitFor(() => expect(document.querySelectorAll('.feedback-ai').length).toBe(0))
    expect(first!.querySelector('.feedback-translation')).toBeNull()
    expect(within(first!).getByText('Der Ton wird zweimal abgespielt.')).toBeTruthy()
    expect((within(second!).getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value).toBe('Asked the designer.')
  })
})
