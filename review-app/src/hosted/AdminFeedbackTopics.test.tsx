import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { FeedbackAiStatus, FeedbackAiView, FeedbackTopicOpened, FeedbackTopicView, FeedbackView, FeedbackWeek } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { AdminFeedback } from './AdminFeedback'
import { dateOf } from './adminUtil'
import { STATE_LABEL } from './FeedbackCard'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

const aiStatus = (over: Partial<FeedbackAiStatus> = {}): FeedbackAiStatus => ({ setUp: true, needs: null, on: true, model: 'test/model', callsToday: 3, dailyCalls: 200, reads: ['en', 'bg'], repo: 'wordado/wordado', ...over })
const AT = Date.parse('2026-10-05T09:00:00Z')
const topic = (id: number, title: string, over: Partial<FeedbackTopicView> = {}): FeedbackTopicView => ({ id, title, state: 'new', note: '', issue: null, issueState: 'none', issueTitle: null, count: 2, newestAt: AT + id * 60_000, worst: null, ...over })
const reading = (over: Partial<FeedbackAiView> = {}): FeedbackAiView => ({ language: 'en', translation: '', category: 'bug', severity: 'annoys', summary: 'The sound plays twice.', topic: { id: 14, title: 'Sound plays twice on phones' }, ...over })
const message = (id: number, over: Partial<FeedbackView> = {}): FeedbackView => ({
  id,
  receivedAt: AT + id * 60_000,
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
  ai: reading(),
  ...over,
})

const sound = topic(14, 'Sound plays twice on phones', { count: 4, worst: 'blocks', issue: 94, issueState: 'proposed', issueTitle: 'The sound of a word plays twice on a phone' })
const words = topic(15, 'Number of new words a day', { count: 1, state: 'seen', note: 'Asked the designer.' })
const theme = topic(12, 'A dark theme', { count: 1, state: 'done', issue: 7, issueState: 'confirmed' })
const opened = (over: Partial<FeedbackTopicOpened> = {}): FeedbackTopicOpened => ({
  topic: sound,
  items: [message(9, { kind: 'other', language: 'de', message: 'Der Ton wird zweimal abgespielt.', ai: reading({ language: 'de', translation: 'The sound is played twice.' }) }), message(4, { message: 'The sound plays twice.' })],
  more: 0,
  incomplete: false,
  ...over,
})

const noWeek: FeedbackWeek = { since: 0, until: 1, read: 0, byCategory: { bug: 0, idea: 0, question: 0, praise: 0, junk: 0 }, blockingBugs: 0, topTopics: [], blocking: [], newTopics: [], paragraph: null }

let listTopics: MockInstance<typeof hostedApi.admin.feedbackTopics>
let openTopic: MockInstance<typeof hostedApi.admin.feedbackTopic>

beforeEach(() => {
  vi.spyOn(hostedApi.admin, 'feedbackAi').mockResolvedValue(aiStatus())
  vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValue({ connected: true, items: [], read: 0, nextBefore: null })
  vi.spyOn(hostedApi.admin, 'readFeedbackAi').mockResolvedValue({ results: {}, asked: 0, left: 0, why: null })
  listTopics = vi.spyOn(hostedApi.admin, 'feedbackTopics').mockResolvedValue([words, sound, theme])
  vi.spyOn(hostedApi.admin, 'feedbackWeek').mockResolvedValue(noWeek)
  openTopic = vi.spyOn(hostedApi.admin, 'feedbackTopic').mockResolvedValue(opened())
})

/** The tab, switched to By topic, with every topic shown: the lines of the list. */
async function byTopic(show = 'all'): Promise<HTMLElement[]> {
  render(<AdminFeedback />)
  fireEvent.change(screen.getByRole('combobox', { name: 'View' }), { target: { value: 'topics' } })
  if (show !== 'open') fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), { target: { value: show } })
  return within(await screen.findByRole('list', { name: 'Topics' })).getAllByRole('listitem')
}
const line = (title: string) => screen.getByRole('button', { name: title }).closest('li')!
/** Opens the topic of a line and gives the line back once its messages are shown. */
async function open(title: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: title }))
  const li = line(title)
  await within(li).findByRole('list', { name: 'Messages of the topic' })
  return li
}

describe('the Feedback tab by topic (spec 2026-10-10 §3.2)', () => {
  it('lists one line a topic, in the order the server gives them: title, count, newest message, worst severity, state', async () => {
    const [first, second, third] = await byTopic()
    expect([first, second, third].map((li) => within(li!).getByRole('heading', { level: 3 }).textContent)).toEqual(['Number of new words a day', 'Sound plays twice on phones', 'A dark theme'])
    expect(within(second!).getByText('4 messages')).toBeTruthy()
    expect(within(second!).getByText(dateOf(new Date(sound.newestAt!).toISOString()))).toBeTruthy()
    expect(within(second!).getByText('Blocks study').className).toBe('chip major')
    expect(within(second!).getByText('New')).toBeTruthy()
    expect(within(first!).getByText('1 message')).toBeTruthy()
    expect(within(first!).getByText('Looked at')).toBeTruthy()
    expect(within(first!).queryByText('Blocks study')).toBeNull()
    expect(within(third!).getByText('Done')).toBeTruthy()
    // A line is closed until it is opened, and nothing is read for it.
    expect(within(second!).getByRole('button', { name: 'Sound plays twice on phones' }).getAttribute('aria-expanded')).toBe('false')
    expect(openTopic).not.toHaveBeenCalled()
    expect(screen.queryByRole('list', { name: 'Feedback' })).toBeNull()
  })

  it('filters the topics by their own state, and stays By topic when the filter changes', async () => {
    const lines = await byTopic('open')
    expect(lines.map((li) => within(li).getByRole('heading', { level: 3 }).textContent)).toEqual(['Number of new words a day', 'Sound plays twice on phones'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), { target: { value: 'done' } })
    expect((screen.getByRole('combobox', { name: 'View' }) as HTMLSelectElement).value).toBe('topics')
    expect(within(screen.getByRole('list', { name: 'Topics' })).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['A dark theme'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), { target: { value: 'declined' } })
    expect(await screen.findByText('Nothing here to show.')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'View' }) as HTMLSelectElement).value).toBe('topics')
    // Kind is the messages' filter: it is not offered here.
    expect(screen.queryByRole('combobox', { name: 'Kind' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'View' }), { target: { value: 'messages' } })
    expect(screen.getByRole('combobox', { name: 'Kind' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Topics' })).toBeNull()
  })

  it('says where topics come from when there are none: from the AI help, which is off, or from its reading', async () => {
    listTopics.mockResolvedValue([])
    vi.spyOn(hostedApi.admin, 'feedbackAi').mockResolvedValue(aiStatus({ on: false }))
    render(<AdminFeedback />)
    fireEvent.change(screen.getByRole('combobox', { name: 'View' }), { target: { value: 'topics' } })
    expect(await screen.findByText('Topics are made by the AI help, which is off.')).toBeTruthy()
    cleanup()
    vi.spyOn(hostedApi.admin, 'feedbackAi').mockResolvedValue(aiStatus())
    render(<AdminFeedback />)
    fireEvent.change(screen.getByRole('combobox', { name: 'View' }), { target: { value: 'topics' } })
    expect(await screen.findByText('No topics yet. The AI makes them as it reads the messages.')).toBeTruthy()
  })

  it('says so when the topics cannot be read, and tries again', async () => {
    listTopics.mockRejectedValueOnce(new Error('internal error')).mockRejectedValueOnce(new Error('internal error')).mockResolvedValue([sound])
    render(<AdminFeedback />)
    fireEvent.change(screen.getByRole('combobox', { name: 'View' }), { target: { value: 'topics' } })
    expect((await screen.findByRole('alert')).textContent).toContain('The topics could not be read.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('list', { name: 'Topics' })).toBeTruthy()
  })

  it('opens a topic with one read, and lists its messages as cards, with their translations', async () => {
    await byTopic()
    const li = await open('Sound plays twice on phones')
    expect(openTopic).toHaveBeenCalledTimes(1)
    expect(openTopic).toHaveBeenCalledWith(14)
    const toggle = within(li).getByRole('button', { name: 'Sound plays twice on phones' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeTruthy()
    const cards = within(within(li).getByRole('list', { name: 'Messages of the topic' })).getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]!).getByText('Der Ton wird zweimal abgespielt.')).toBeTruthy()
    expect(within(cards[0]!).getByText('The sound is played twice.').className).toBe('feedback-translation')
    expect(within(li).queryByText(/older/)).toBeNull()
    expect(within(li).queryByText(/may be missing/)).toBeNull()
    // Closed, its messages are out of the page; opened again, they are read again.
    fireEvent.click(toggle)
    expect(within(li).queryByRole('list', { name: 'Messages of the topic' })).toBeNull()
    await open('Sound plays twice on phones')
    expect(openTopic).toHaveBeenCalledTimes(2)
  })

  it('says how many older messages a topic has, and when messages may be missing', async () => {
    openTopic.mockResolvedValue(opened({ more: 8, incomplete: true }))
    await byTopic()
    const li = await open('Sound plays twice on phones')
    expect(within(li).getByText('and 8 older messages, not shown here.')).toBeTruthy()
    expect(within(li).getByText('Some messages may be missing here: the app’s server does not give messages by their ids yet.')).toBeTruthy()
  })

  it('says so when a topic’s messages cannot be read, and tries again', async () => {
    openTopic.mockRejectedValueOnce(new Error('The app’s server answered 500.'))
    await byTopic()
    fireEvent.click(screen.getByRole('button', { name: 'Sound plays twice on phones' }))
    const li = line('Sound plays twice on phones')
    expect((await within(li).findByRole('alert')).textContent).toContain('The messages could not be read. The app’s server answered 500.')
    fireEvent.click(within(li).getByRole('button', { name: 'Try again' }))
    expect(await within(li).findByRole('list', { name: 'Messages of the topic' })).toBeTruthy()
  })

  it('renames a topic: the title becomes a field, and Save keeps it', async () => {
    const put = vi.spyOn(hostedApi.admin, 'putFeedbackTopic').mockResolvedValue({ topic: { ...sound, title: 'The sound is played twice' }, marked: 0 })
    await byTopic()
    const li = await open('Sound plays twice on phones')
    fireEvent.click(within(li).getByRole('button', { name: 'Rename' }))
    const field = within(li).getByRole('textbox', { name: 'Title' }) as HTMLInputElement
    expect(field.value).toBe('Sound plays twice on phones')
    expect(field.maxLength).toBe(80)
    // Cancel puts the title back, and nothing is sent.
    fireEvent.change(field, { target: { value: 'Something else' } })
    fireEvent.click(within(li).getByRole('button', { name: 'Cancel' }))
    expect(within(li).queryByRole('textbox', { name: 'Title' })).toBeNull()
    expect(put).not.toHaveBeenCalled()
    fireEvent.click(within(li).getByRole('button', { name: 'Rename' }))
    fireEvent.change(within(li).getByRole('textbox', { name: 'Title' }), { target: { value: ' The sound is played twice ' } })
    listTopics.mockResolvedValue([words, { ...sound, title: 'The sound is played twice' }, theme])
    fireEvent.click(within(li).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: 'The sound is played twice' })).toBeTruthy()
    expect(put).toHaveBeenCalledWith(14, { title: 'The sound is played twice', state: 'new', note: '' })
    expect(within(li).queryByRole('textbox', { name: 'Title' })).toBeNull()
    // Still open, with its messages.
    expect(within(li).getByRole('list', { name: 'Messages of the topic' })).toBeTruthy()
  })

  it('shows why a rename was refused, and keeps what was typed', async () => {
    vi.spyOn(hostedApi.admin, 'putFeedbackTopic').mockRejectedValue(new Error('Another topic has this title. Merge the two instead.'))
    await byTopic()
    const li = await open('Sound plays twice on phones')
    fireEvent.click(within(li).getByRole('button', { name: 'Rename' }))
    fireEvent.change(within(li).getByRole('textbox', { name: 'Title' }), { target: { value: 'Number of new words a day' } })
    fireEvent.click(within(li).getByRole('button', { name: 'Save' }))
    expect((await within(li).findByRole('alert')).textContent).toBe('Not renamed: Another topic has this title. Merge the two instead.')
    expect((within(li).getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('Number of new words a day')
  })

  it('merges a topic into another after saying what happens', async () => {
    const merge = vi.spyOn(hostedApi.admin, 'mergeFeedbackTopic').mockResolvedValue({ ...words, count: 5 })
    await byTopic()
    const li = await open('Sound plays twice on phones')
    const select = within(li).getByRole('combobox', { name: 'Merge into…' }) as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose a topic', 'Number of new words a day', 'A dark theme'])
    fireEvent.change(select, { target: { value: '15' } })
    const dialog = await screen.findByRole('dialog', { name: 'Merge topics' })
    expect(within(dialog).getByText('The 4 messages of “Sound plays twice on phones” go to “Number of new words a day”, with its note. “Sound plays twice on phones” is then gone. This cannot be undone.')).toBeTruthy()
    // Keep both: nothing is sent.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep both' }))
    expect(merge).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.change(within(li).getByRole('combobox', { name: 'Merge into…' }), { target: { value: '15' } })
    listTopics.mockResolvedValue([{ ...words, count: 5 }, theme])
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Merge topics' })).getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sound plays twice on phones' })).toBeNull())
    expect(merge).toHaveBeenCalledWith(14, 15)
    expect(within(line('Number of new words a day')).getByText('5 messages')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows in the dialog why a merge was refused', async () => {
    vi.spyOn(hostedApi.admin, 'mergeFeedbackTopic').mockRejectedValue(new Error('no such topic'))
    await byTopic()
    const li = await open('Sound plays twice on phones')
    fireEvent.change(within(li).getByRole('combobox', { name: 'Merge into…' }), { target: { value: '15' } })
    const dialog = await screen.findByRole('dialog', { name: 'Merge topics' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('no such topic')
  })

  it('keeps a topic’s state when it is chosen and its note on Save, each with the other as it was', async () => {
    const put = vi.spyOn(hostedApi.admin, 'putFeedbackTopic').mockImplementation(async (_id, t) => ({ topic: { ...words, ...t }, marked: 0 }))
    await byTopic()
    openTopic.mockResolvedValue(opened({ topic: words, items: [message(2, { ai: reading({ topic: { id: 15, title: words.title } }) })] }))
    const li = await open('Number of new words a day')
    const mark = within(li).getByRole('form', { name: 'The topic’s mark' })
    const note = within(mark).getByRole('textbox', { name: 'Topic note' }) as HTMLTextAreaElement
    expect(note.value).toBe('Asked the designer.')
    expect((within(mark).getByRole('combobox', { name: 'Topic state' }) as HTMLSelectElement).value).toBe('seen')
    fireEvent.change(within(mark).getByRole('combobox', { name: 'Topic state' }), { target: { value: 'declined' } })
    await waitFor(() => expect(put).toHaveBeenCalledWith(15, { title: 'Number of new words a day', state: 'declined', note: 'Asked the designer.' }))
    fireEvent.change(note, { target: { value: ' Not this year. ' } })
    fireEvent.click(within(mark).getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(put).toHaveBeenLastCalledWith(15, { title: 'Number of new words a day', state: 'declined', note: 'Not this year.' }))
    await waitFor(() => expect(within(mark).getAllByText('Saved')).toHaveLength(2))
    // Not doing marks no message: the messages are not read again.
    expect(openTopic).toHaveBeenCalledTimes(1)
  })

  it('says how many messages were marked when a topic is marked Done, and shows them as they are now', async () => {
    vi.spyOn(hostedApi.admin, 'putFeedbackTopic').mockResolvedValue({ topic: { ...sound, state: 'done' }, marked: 4 })
    await byTopic()
    const li = await open('Sound plays twice on phones')
    openTopic.mockResolvedValue(opened({ items: opened().items.map((m) => ({ ...m, state: 'done' as const })) }))
    fireEvent.change(within(within(li).getByRole('form', { name: 'The topic’s mark' })).getByRole('combobox', { name: 'Topic state' }), { target: { value: 'done' } })
    expect(await within(li).findByText('4 messages marked done.')).toBeTruthy()
    await waitFor(() => expect(openTopic).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      const states = within(within(li).getByRole('list', { name: 'Messages of the topic' })).getAllByRole('combobox', { name: 'State' }) as HTMLSelectElement[]
      expect(states.map((s) => s.value)).toEqual(['done', 'done'])
    })
  })

  it('folds a message’s own mark away inside a topic, and shows its state in the head', async () => {
    await byTopic()
    const li = await open('Sound plays twice on phones')
    const first = within(within(li).getByRole('list', { name: 'Messages of the topic' })).getAllByRole('article')[0]!
    const fold = within(first).getByText('Mark this message').closest('details')!
    expect(fold.open).toBe(false)
    expect(within(fold).getByRole('combobox', { name: 'State' })).toBeTruthy()
    expect(first.querySelector('.feedback-head .chip:last-child')?.textContent).toBe(STATE_LABEL[opened().items[0]!.state])
  })

  it('puts the state back when it was refused, and says why', async () => {
    vi.spyOn(hostedApi.admin, 'putFeedbackTopic').mockRejectedValue(new Error('internal error'))
    await byTopic()
    const li = await open('Sound plays twice on phones')
    const mark = within(li).getByRole('form', { name: 'The topic’s mark' })
    fireEvent.change(within(mark).getByRole('combobox', { name: 'Topic state' }), { target: { value: 'done' } })
    expect(await within(mark).findByText('State not saved: internal error')).toBeTruthy()
    expect((within(mark).getByRole('combobox', { name: 'Topic state' }) as HTMLSelectElement).value).toBe('new')
  })

  it('moves a message to another topic from its card: it leaves this topic', async () => {
    const move = vi.spyOn(hostedApi.admin, 'moveFeedback').mockResolvedValue({ id: 4, topic: { id: 15, title: 'Number of new words a day' } })
    await byTopic()
    const li = await open('Sound plays twice on phones')
    const cards = () => within(within(li).getByRole('list', { name: 'Messages of the topic' })).getAllByRole('listitem')
    const select = within(cards()[1]!).getByRole('combobox', { name: 'Move to…' }) as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose a topic', 'Number of new words a day', 'A dark theme', 'New topic…'])
    listTopics.mockResolvedValue([{ ...words, count: 2 }, { ...sound, count: 3 }, theme])
    fireEvent.change(select, { target: { value: '15' } })
    await waitFor(() => expect(cards()).toHaveLength(1))
    expect(move).toHaveBeenCalledWith(4, 15)
    expect(within(cards()[0]!).getByText('Der Ton wird zweimal abgespielt.')).toBeTruthy()
    expect(await within(li).findByText('3 messages')).toBeTruthy()
  })
})

describe('a topic’s match with a known issue (spec 2026-10-10 §3.3)', () => {
  it('shows a proposed match as "looks like #N", a link to the issue, with Confirm and Remove; a confirmed one as its number', async () => {
    const [, second, third] = await byTopic()
    const link = within(second!).getByRole('link', { name: 'looks like #94' })
    expect(link.getAttribute('href')).toBe('https://github.com/wordado/wordado/issues/94')
    expect(link.getAttribute('title')).toBe('The sound of a word plays twice on a phone')
    expect(link.getAttribute('rel')).toBe('noreferrer')
    expect(within(second!).getByRole('button', { name: 'Confirm' })).toBeTruthy()
    expect(within(second!).getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect(within(third!).getByRole('link', { name: '#7' }).getAttribute('href')).toBe('https://github.com/wordado/wordado/issues/7')
    expect(within(third!).queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(within(third!).queryByText(/looks like/)).toBeNull()
  })

  it('confirms a proposed match, or removes it', async () => {
    const set = vi.spyOn(hostedApi.admin, 'setFeedbackTopicIssue').mockResolvedValue({ ...sound, issueState: 'confirmed' })
    await byTopic()
    listTopics.mockResolvedValue([words, { ...sound, issueState: 'confirmed' }, theme])
    fireEvent.click(within(line('Sound plays twice on phones')).getByRole('button', { name: 'Confirm' }))
    expect(await within(line('Sound plays twice on phones')).findByRole('link', { name: '#94' })).toBeTruthy()
    expect(set).toHaveBeenCalledWith(14, 94)
    expect(within(line('Sound plays twice on phones')).queryByRole('button', { name: 'Confirm' })).toBeNull()
    cleanup()
    listTopics.mockResolvedValue([words, sound, theme])
    await byTopic()
    listTopics.mockResolvedValue([words, { ...sound, issue: null, issueState: 'removed', issueTitle: null }, theme])
    fireEvent.click(within(line('Sound plays twice on phones')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(within(line('Sound plays twice on phones')).queryByRole('link')).toBeNull())
    expect(set).toHaveBeenLastCalledWith(14, null)
  })

  it('takes an issue number the coordinator types, as 94 or #94, and removes the match when the field is emptied', async () => {
    const set = vi.spyOn(hostedApi.admin, 'setFeedbackTopicIssue').mockResolvedValue({ ...words, issue: 94, issueState: 'confirmed' })
    await byTopic()
    openTopic.mockResolvedValue(opened({ topic: words, items: [message(2, { ai: reading({ topic: { id: 15, title: words.title } }) })] }))
    const li = await open('Number of new words a day')
    const field = within(li).getByRole('textbox', { name: 'Issue number' }) as HTMLInputElement
    expect(field.value).toBe('')
    fireEvent.change(field, { target: { value: 'ninety-four' } })
    fireEvent.click(within(li).getByRole('button', { name: 'Save issue' }))
    expect((await within(li).findByRole('alert')).textContent).toBe('Type the number of an issue, such as 94.')
    expect(set).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: ' #94 ' } })
    listTopics.mockResolvedValue([{ ...words, issue: 94, issueState: 'confirmed' }, sound, theme])
    fireEvent.click(within(li).getByRole('button', { name: 'Save issue' }))
    expect(await within(li).findByRole('link', { name: '#94' })).toBeTruthy()
    expect(set).toHaveBeenCalledWith(15, 94)
    await waitFor(() => expect((within(li).getByRole('textbox', { name: 'Issue number' }) as HTMLInputElement).value).toBe('94'))
    fireEvent.change(within(li).getByRole('textbox', { name: 'Issue number' }), { target: { value: '' } })
    listTopics.mockResolvedValue([{ ...words, issue: null, issueState: 'removed' }, sound, theme])
    fireEvent.click(within(li).getByRole('button', { name: 'Save issue' }))
    await waitFor(() => expect(set).toHaveBeenLastCalledWith(15, null))
  })

  it('shows the number without a link while no repository is set', async () => {
    vi.spyOn(hostedApi.admin, 'feedbackAi').mockResolvedValue(aiStatus({ repo: '' }))
    const [, second] = await byTopic()
    expect(within(second!).getByText('looks like #94')).toBeTruthy()
    expect(within(second!).queryByRole('link')).toBeNull()
  })

  it('says why a match was not kept', async () => {
    vi.spyOn(hostedApi.admin, 'setFeedbackTopicIssue').mockRejectedValue(new Error('internal error'))
    await byTopic()
    fireEvent.click(within(line('Sound plays twice on phones')).getByRole('button', { name: 'Confirm' }))
    expect((await within(line('Sound plays twice on phones')).findByRole('alert')).textContent).toBe('Not kept: internal error')
  })
})

describe('a message’s topic on its card, among the messages', () => {
  const inSound = message(4, { message: 'The sound plays twice.' })
  const inNone = message(3, { message: 'Thank you.', ai: reading({ category: 'praise', severity: null, summary: 'Thanks.', topic: null }) })
  const unread = message(2, { message: 'Not read yet.', ai: null })
  const cards = async () => within(await screen.findByRole('list', { name: 'Feedback' })).getAllByRole('listitem')

  it('shows the topic of each message the AI has read, and offers the other topics to move it to', async () => {
    vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValue({ connected: true, items: [inSound, inNone, unread], read: 3, nextBefore: null })
    render(<AdminFeedback />)
    const [first, second, third] = await cards()
    expect(within(first!).getByText('Topic: Sound plays twice on phones')).toBeTruthy()
    const select = (await within(first!).findByRole('combobox', { name: 'Move to…' })) as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose a topic', 'Number of new words a day', 'A dark theme', 'New topic…'])
    expect(within(second!).getByText('Topic: none')).toBeTruthy()
    expect([...(within(second!).getByRole('combobox', { name: 'Move to…' }) as HTMLSelectElement).options]).toHaveLength(5)
    // A message with no reading is in no topic and cannot be moved.
    expect(within(third!).queryByText(/^Topic:/)).toBeNull()
    expect(within(third!).queryByRole('combobox', { name: 'Move to…' })).toBeNull()
  })

  it('moves a message, shows its new topic, and stays among the messages', async () => {
    vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValue({ connected: true, items: [inSound, inNone], read: 2, nextBefore: null })
    const move = vi.spyOn(hostedApi.admin, 'moveFeedback').mockResolvedValue({ id: 4, topic: { id: 15, title: 'Number of new words a day' } })
    render(<AdminFeedback />)
    const [first] = await cards()
    fireEvent.change(await within(first!).findByRole('combobox', { name: 'Move to…' }), { target: { value: '15' } })
    expect(await within(first!).findByText('Topic: Number of new words a day')).toBeTruthy()
    expect(move).toHaveBeenCalledWith(4, 15)
    expect((await cards())).toHaveLength(2)
    const select = within(first!).getByRole('combobox', { name: 'Move to…' }) as HTMLSelectElement
    expect(select.value).toBe('')
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose a topic', 'Sound plays twice on phones', 'A dark theme', 'New topic…'])
  })

  it('says why a message was not moved, and leaves it where it was', async () => {
    vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValue({ connected: true, items: [inSound], read: 1, nextBefore: null })
    vi.spyOn(hostedApi.admin, 'moveFeedback').mockRejectedValue(new Error('The message has no AI result yet, or there is no such topic.'))
    render(<AdminFeedback />)
    const [first] = await cards()
    fireEvent.change(await within(first!).findByRole('combobox', { name: 'Move to…' }), { target: { value: '15' } })
    expect(await within(first!).findByText('Topic not saved: The message has no AI result yet, or there is no such topic.')).toBeTruthy()
    expect(within(first!).getByText('Topic: Sound plays twice on phones')).toBeTruthy()
  })

  it('gives a message no topic suits a new topic, with the title typed (issue 260)', async () => {
    vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValue({ connected: true, items: [inSound], read: 1, nextBefore: null })
    const move = vi.spyOn(hostedApi.admin, 'moveFeedback').mockResolvedValue({ id: 4, topic: { id: 21, title: 'Streak is lost at midnight' } })
    render(<AdminFeedback />)
    const [first] = await cards()
    fireEvent.change(await within(first!).findByRole('combobox', { name: 'Move to…' }), { target: { value: 'new' } })
    const form = within(first!).getByRole('form', { name: 'A new topic' })
    const title = within(form).getByRole('textbox', { name: 'New topic’s title' }) as HTMLInputElement
    expect(document.activeElement).toBe(title)
    // The list of topics gives way to the field, and nothing is sent for a title too short to be one.
    expect(within(first!).queryByRole('combobox', { name: 'Move to…' })).toBeNull()
    const make = within(form).getByRole('button', { name: 'Make the topic' }) as HTMLButtonElement
    fireEvent.change(title, { target: { value: 'St' } })
    expect(make.disabled).toBe(true)
    fireEvent.change(title, { target: { value: ' Streak is lost at midnight ' } })
    listTopics.mockResolvedValue([topic(21, 'Streak is lost at midnight', { count: 1 }), words, sound, theme])
    fireEvent.click(make)
    expect(await within(first!).findByText('Topic: Streak is lost at midnight')).toBeTruthy()
    expect(move).toHaveBeenCalledWith(4, { title: 'Streak is lost at midnight' })
    // The field is gone, and the new topic is one of those the tab knows.
    expect(within(first!).queryByRole('form', { name: 'A new topic' })).toBeNull()
    await waitFor(() => expect([...(within(first!).getByRole('combobox', { name: 'Move to…' }) as HTMLSelectElement).options].map((o) => o.textContent)).toContain('Sound plays twice on phones'))
  })

  it('keeps the title typed when the new topic is refused, and Cancel brings the list of topics back', async () => {
    vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValue({ connected: true, items: [inSound], read: 1, nextBefore: null })
    vi.spyOn(hostedApi.admin, 'moveFeedback').mockRejectedValue(new Error('title must be one line'))
    render(<AdminFeedback />)
    const [first] = await cards()
    fireEvent.change(await within(first!).findByRole('combobox', { name: 'Move to…' }), { target: { value: 'new' } })
    fireEvent.change(within(first!).getByRole('textbox', { name: 'New topic’s title' }), { target: { value: 'See example.com' } })
    fireEvent.click(within(first!).getByRole('button', { name: 'Make the topic' }))
    expect(await within(first!).findByText('Topic not saved: title must be one line')).toBeTruthy()
    expect((within(first!).getByRole('textbox', { name: 'New topic’s title' }) as HTMLInputElement).value).toBe('See example.com')
    expect(within(first!).getByText('Topic: Sound plays twice on phones')).toBeTruthy()
    fireEvent.click(within(first!).getByRole('button', { name: 'Cancel' }))
    expect(within(first!).getByRole('combobox', { name: 'Move to…' })).toBeTruthy()
  })

  it('reads the topics again after the AI has read a page, which may have made new ones', async () => {
    vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValue({ connected: true, items: [unread], read: 1, nextBefore: null })
    vi.spyOn(hostedApi.admin, 'readFeedbackAi').mockResolvedValue({ results: { 2: reading({ topic: { id: 20, title: 'A new topic' } }) }, asked: 1, left: 0, why: null })
    listTopics.mockResolvedValueOnce([sound]).mockResolvedValue([topic(20, 'A new topic'), sound])
    render(<AdminFeedback />)
    const [first] = await cards()
    expect(await within(first!).findByText('Topic: A new topic')).toBeTruthy()
    await waitFor(() => expect(listTopics).toHaveBeenCalledTimes(2))
  })
})

describe('Draft an issue, on a message’s card (issue 260)', () => {
  const inSound = message(4, { message: 'The sound plays twice.' })
  const inNone = message(3, { message: 'Thank you.', ai: reading({ category: 'praise', severity: null, summary: 'Thanks.', topic: null }) })
  const unread = message(2, { message: 'Not read yet.', ai: null })
  const cards = async () => within(await screen.findByRole('list', { name: 'Feedback' })).getAllByRole('listitem')
  const listedAs = (items: FeedbackView[]) => vi.spyOn(hostedApi.admin, 'feedback').mockResolvedValue({ connected: true, items, read: items.length, nextBefore: null })

  it('drafts for the topic the message is in, and the filed issue’s number becomes that topic’s match', async () => {
    listedAs([inSound])
    const ask = vi.spyOn(hostedApi.admin, 'draftFeedbackTopic').mockResolvedValue({ ok: true, title: 'Audio is heard twice', body: 'In our words.', messages: 4 })
    const save = vi.spyOn(hostedApi.admin, 'setFeedbackTopicIssue').mockResolvedValue({ ...sound, issue: 95, issueState: 'confirmed' })
    render(<AdminFeedback />)
    const [first] = await cards()
    const button = within(first!).getByRole('button', { name: 'Draft an issue' }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)
    const dialog = await screen.findByRole('dialog', { name: 'Draft an issue' })
    await waitFor(() => expect((within(dialog).getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('Audio is heard twice'))
    expect(ask).toHaveBeenCalledWith(sound.id)
    const read = listTopics.mock.calls.length
    fireEvent.change(within(dialog).getByRole('textbox', { name: /paste its number/ }), { target: { value: '#95' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(save).toHaveBeenCalledWith(sound.id, 95)
    expect(listTopics.mock.calls.length).toBeGreaterThan(read)
    expect(await cards()).toHaveLength(1)
  })

  it('drafts for a topic made a moment ago, once the topics are read again', async () => {
    listedAs([inSound])
    vi.spyOn(hostedApi.admin, 'moveFeedback').mockResolvedValue({ id: 4, topic: { id: 21, title: 'Streak is lost at midnight' } })
    const ask = vi.spyOn(hostedApi.admin, 'draftFeedbackTopic').mockResolvedValue({ ok: true, title: 'Streak', body: 'In our words.', messages: 1 })
    render(<AdminFeedback />)
    const [first] = await cards()
    fireEvent.change(await within(first!).findByRole('combobox', { name: 'Move to…' }), { target: { value: 'new' } })
    fireEvent.change(within(first!).getByRole('textbox', { name: 'New topic’s title' }), { target: { value: 'Streak is lost at midnight' } })
    listTopics.mockResolvedValue([topic(21, 'Streak is lost at midnight', { count: 1 }), words, sound, theme])
    fireEvent.click(within(first!).getByRole('button', { name: 'Make the topic' }))
    await within(first!).findByText('Topic: Streak is lost at midnight')
    fireEvent.click(within(first!).getByRole('button', { name: 'Draft an issue' }))
    await screen.findByRole('dialog', { name: 'Draft an issue' })
    await waitFor(() => expect(ask).toHaveBeenCalledWith(21))
  })

  it('is not on a message the AI has not read, and waits for a topic on one that is in none', async () => {
    listedAs([inNone, unread])
    render(<AdminFeedback />)
    const [first, second] = await cards()
    const button = within(first!).getByRole('button', { name: 'Draft an issue' }) as HTMLButtonElement
    await waitFor(() => expect(within(first!).getByText('Give the message a topic first.')).toBeTruthy())
    expect(button.disabled).toBe(true)
    expect(within(second!).queryByRole('button', { name: 'Draft an issue' })).toBeNull()
  })

  it('cannot be asked for while the AI help is off, and says why', async () => {
    vi.spyOn(hostedApi.admin, 'feedbackAi').mockResolvedValue(aiStatus({ on: false }))
    listedAs([inSound])
    render(<AdminFeedback />)
    const [first] = await cards()
    expect((within(first!).getByRole('button', { name: 'Draft an issue' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(first!).getByText('Needs the AI help, which is off or not set up.')).toBeTruthy()
  })

  it('is not repeated on the cards of an opened topic, which has its own', async () => {
    await byTopic()
    const li = await open('Number of new words a day')
    expect(within(li).getAllByRole('button', { name: 'Draft an issue' })).toHaveLength(1)
  })
})

describe('a topic chosen in the week’s summary (spec 2026-10-10 §3.4)', () => {
  const week: FeedbackWeek = { ...noWeek, read: 5, byCategory: { ...noWeek.byCategory, bug: 5 }, topTopics: [{ id: theme.id, title: theme.title, count: 1 }, { id: sound.id, title: sound.title, count: 4 }], paragraph: 'Five messages came.' }

  it('opens By topic at that topic, with its messages, whatever the filter hid', async () => {
    vi.spyOn(hostedApi.admin, 'feedbackWeek').mockResolvedValue(week)
    render(<AdminFeedback />)
    // The tab starts with the messages, and shows what is open: the topic chosen is done.
    const summary = await screen.findByRole('region', { name: 'This week' })
    fireEvent.click(within(summary).getByRole('button', { name: theme.title }))
    const topics = await screen.findByRole('list', { name: 'Topics' })
    expect((screen.getByRole('combobox', { name: 'View' }) as HTMLSelectElement).value).toBe('topics')
    expect((screen.getByRole('combobox', { name: 'Show' }) as HTMLSelectElement).value).toBe('all')
    const chosen = within(topics).getByRole('button', { name: theme.title })
    await waitFor(() => expect(chosen.getAttribute('aria-expanded')).toBe('true'))
    expect(openTopic).toHaveBeenCalledWith(theme.id)
    expect(openTopic).toHaveBeenCalledTimes(1)
    // Another one chosen opens too; the first stays as it is.
    fireEvent.click(within(summary).getByRole('button', { name: sound.title }))
    await waitFor(() => expect(within(topics).getByRole('button', { name: sound.title }).getAttribute('aria-expanded')).toBe('true'))
    expect(openTopic).toHaveBeenLastCalledWith(sound.id)
    expect(chosen.getAttribute('aria-expanded')).toBe('true')
  })
})

describe('Draft an issue, on an opened topic (spec 2026-10-10 §3.5)', () => {
  it('opens the draft’s dialog for that topic, and the filed issue’s number becomes the topic’s match', async () => {
    const ask = vi.spyOn(hostedApi.admin, 'draftFeedbackTopic').mockResolvedValue({ ok: true, title: 'Audio is heard twice', body: 'In our words.', messages: 2 })
    const save = vi.spyOn(hostedApi.admin, 'setFeedbackTopicIssue').mockResolvedValue({ ...words, issue: 95, issueState: 'confirmed' })
    await byTopic()
    const li = await open('Number of new words a day')
    fireEvent.click(within(li).getByRole('button', { name: 'Draft an issue' }))
    const dialog = await screen.findByRole('dialog', { name: 'Draft an issue' })
    await waitFor(() => expect((within(dialog).getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('Audio is heard twice'))
    expect(ask).toHaveBeenCalledWith(words.id)
    expect((within(dialog).getByRole('link', { name: 'Open on GitHub' }) as HTMLAnchorElement).href).toContain('https://github.com/wordado/wordado/issues/new?title=Audio+is+heard+twice')
    listTopics.mockResolvedValue([{ ...words, issue: 95, issueState: 'confirmed' }, sound, theme])
    fireEvent.change(within(dialog).getByRole('textbox', { name: /paste its number/ }), { target: { value: '#95' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(save).toHaveBeenCalledWith(words.id, 95)
    expect((await within(line('Number of new words a day')).findByRole('link', { name: '#95' })).getAttribute('href')).toBe('https://github.com/wordado/wordado/issues/95')
  })

  it('cannot be asked for while the AI help is off, and says why', async () => {
    vi.spyOn(hostedApi.admin, 'feedbackAi').mockResolvedValue(aiStatus({ on: false }))
    const ask = vi.spyOn(hostedApi.admin, 'draftFeedbackTopic')
    await byTopic()
    const li = await open('Number of new words a day')
    const button = within(li).getByRole('button', { name: 'Draft an issue' }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(true))
    expect(within(li).getByText('Needs the AI help, which is off or not set up.')).toBeTruthy()
    fireEvent.click(button)
    expect(ask).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
