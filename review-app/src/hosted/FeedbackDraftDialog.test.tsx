import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedbackDraft, FeedbackTopicView } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { FeedbackDraftDialog } from './FeedbackDraftDialog'
import { ISSUE_URL_MAX } from './issueUrl'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

const topic: FeedbackTopicView = { id: 14, title: 'Sound plays twice on phones', state: 'new', note: '', issue: null, issueState: 'none', issueTitle: null, count: 4, newestAt: 1, worst: 'annoys' }
const GOOD: FeedbackDraft = { ok: true, title: 'Audio of a word is heard twice on phones', body: '## What happens\nA word’s audio repeats.', messages: 4 }

function shown(answer: FeedbackDraft | Error | Promise<FeedbackDraft>, props: { repo?: string } = {}) {
  const ask = vi.spyOn(hostedApi.admin, 'draftFeedbackTopic')
  if (answer instanceof Error) ask.mockRejectedValue(answer)
  else ask.mockImplementation(async () => answer)
  const onClose = vi.fn()
  const onFiled = vi.fn()
  render(<FeedbackDraftDialog open topic={topic} repo={props.repo ?? 'wordado/wordado'} dailyCalls={200} onClose={onClose} onFiled={onFiled} />)
  const dialog = screen.getByRole('dialog', { name: 'Draft an issue' })
  const title = () => within(dialog).getByRole('textbox', { name: 'Title' }) as HTMLInputElement
  const text = () => within(dialog).getByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement
  const link = () => within(dialog).getByRole('link', { name: 'Open on GitHub' }) as HTMLAnchorElement
  const params = () => new URL(link().href).searchParams
  return { ask, onClose, onFiled, dialog, title, text, link, params }
}

describe('FeedbackDraftDialog: the draft of an issue (spec 2026-10-10 §3.5)', () => {
  it('asks for the draft of its topic once, says so while the AI writes, and shows no link yet', async () => {
    let done: (draft: FeedbackDraft) => void = () => undefined
    const { ask, dialog, title } = shown(new Promise<FeedbackDraft>((resolve) => (done = resolve)))
    expect(within(dialog).getByRole('status').textContent).toBe('The AI is writing a draft…')
    expect(within(dialog).queryByRole('link', { name: 'Open on GitHub' })).toBeNull()
    expect(ask).toHaveBeenCalledWith(14)
    done(GOOD)
    await waitFor(() => expect(title().value).toBe('Audio of a word is heard twice on phones'))
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('shows the draft in two fields that can be changed, and says it was written by the AI and becomes public', async () => {
    const { dialog, title, text } = shown(GOOD)
    await waitFor(() => expect(text().value).toBe('## What happens\nA word’s audio repeats.'))
    expect(title().value).toBe('Audio of a word is heard twice on phones')
    expect(within(dialog).getByText('Written by the AI from 4 messages. Read it before you file it: it becomes public under your name.')).toBeTruthy()
    fireEvent.change(title(), { target: { value: 'Mine' } })
    fireEvent.change(text(), { target: { value: 'My own words.' } })
    expect(title().value).toBe('Mine')
    expect(text().value).toBe('My own words.')
  })

  it('offers Open on GitHub: a link to the repository’s new-issue page that follows what is in the fields now', async () => {
    const { title, text, link, params } = shown(GOOD)
    await waitFor(() => expect(link().href.startsWith('https://github.com/wordado/wordado/issues/new?')).toBe(true))
    expect(link().target).toBe('_blank')
    expect(link().rel).toBe('noopener noreferrer')
    expect(params().get('title')).toBe('Audio of a word is heard twice on phones')
    expect(params().get('body')).toBe('## What happens\nA word’s audio repeats.')
    fireEvent.change(title(), { target: { value: 'Audio & more #2' } })
    fireEvent.change(text(), { target: { value: 'Changed.' } })
    expect(params().get('title')).toBe('Audio & more #2')
    expect(params().get('body')).toBe('Changed.')
  })

  it('says a text is too long for a link, links with the title alone, and copies the text', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { dialog, text, params } = shown(GOOD)
    await waitFor(() => expect(params().get('body')).not.toBeNull())
    expect(within(dialog).queryByRole('button', { name: 'Copy the text' })).toBeNull()
    const long = 'я'.repeat(ISSUE_URL_MAX / 4)
    fireEvent.change(text(), { target: { value: long } })
    expect(within(dialog).getByText('The text is too long for a link. Copy it, and paste it into the issue that opens.')).toBeTruthy()
    expect(params().get('body')).toBeNull()
    expect(params().get('title')).toBe('Audio of a word is heard twice on phones')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy the text' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(long))
    expect(await within(dialog).findByText('Copied.')).toBeTruthy()
    // Short again: the link carries it, and nothing needs copying.
    fireEvent.change(text(), { target: { value: 'Short.' } })
    expect(params().get('body')).toBe('Short.')
    expect(within(dialog).queryByRole('button', { name: 'Copy the text' })).toBeNull()
  })

  it('says when the text could not be copied', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) }, configurable: true })
    const { dialog, text } = shown(GOOD)
    await waitFor(() => expect(text().value).not.toBe(''))
    fireEvent.change(text(), { target: { value: 'я'.repeat(ISSUE_URL_MAX / 4) } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy the text' }))
    expect(await within(dialog).findByText('Not copied: select the text and copy it yourself.')).toBeTruthy()
  })

  it('says a draft that repeated a learner’s words was dropped, leaves the fields empty to write by hand, and tries again when asked', async () => {
    const { ask, dialog, title, text, params } = shown({ ok: false, why: 'quoted' })
    expect((await within(dialog).findByRole('alert')).textContent).toBe('The AI’s draft repeated a learner’s words and was dropped. Write the issue yourself, or try again.')
    expect(title().value).toBe('')
    expect(text().value).toBe('')
    fireEvent.change(title(), { target: { value: 'By hand' } })
    expect(params().get('title')).toBe('By hand')
    ask.mockResolvedValue(GOOD)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(title().value).toBe('Audio of a word is heard twice on phones'))
    expect(ask).toHaveBeenCalledTimes(2)
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('says each other reason in one line, and offers another try only where one can help', async () => {
    const lines: [FeedbackDraft & { ok: false }, string, boolean][] = [
      [{ ok: false, why: 'personal' }, 'The AI’s draft held an address, a link, a phone number or the name of an account, and was dropped. Write the issue yourself, or try again.', true],
      [{ ok: false, why: 'late' }, 'The AI wrote no draft this time (it took too long). Write the issue yourself, or try again.', true],
      [{ ok: false, why: 'unfit' }, 'The AI wrote no draft this time (its answer could not be used). Write the issue yourself, or try again.', true],
      [{ ok: false, why: 'limit' }, 'Today’s limit of 200 AI calls is reached. Write the issue yourself.', false],
      [{ ok: false, why: 'off' }, 'AI help is off. Write the issue yourself.', false],
      [{ ok: false, why: 'not-set-up' }, 'AI help is not set up. Write the issue yourself.', false],
      [{ ok: false, why: 'no-messages' }, 'This topic has no messages left to write from. Write the issue yourself.', false],
    ]
    for (const [answer, line, again] of lines) {
      const { dialog } = shown(answer)
      expect((await within(dialog).findByRole('alert')).textContent).toBe(line)
      expect(within(dialog).queryByRole('button', { name: 'Try again' }) !== null).toBe(again)
      cleanup()
      vi.restoreAllMocks()
    }
  })

  it('says when the request itself failed, with what the server said', async () => {
    const { dialog } = shown(new Error('The app’s server could not be reached.'))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('No draft: The app’s server could not be reached. Write the issue yourself, or try again.')
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('takes the number or the address of the filed issue, keeps it as the topic’s match, and closes', async () => {
    const save = vi.spyOn(hostedApi.admin, 'setFeedbackTopicIssue').mockResolvedValue({ ...topic, issue: 95, issueState: 'confirmed' })
    const { dialog, onClose, onFiled, title } = shown(GOOD)
    await waitFor(() => expect(title().value).not.toBe(''))
    const field = within(dialog).getByRole('textbox', { name: 'When the issue is filed, paste its number or its address here' })
    const button = within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(field, { target: { value: 'https://github.com/wordado/wordado/issues/95' } })
    fireEvent.click(button)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenCalledWith(14, 95)
    expect(onFiled).toHaveBeenCalledTimes(1)
  })

  it('refuses in place what is not an issue of this repository, and says why a number was not kept', async () => {
    const save = vi.spyOn(hostedApi.admin, 'setFeedbackTopicIssue').mockRejectedValue(new Error('no such topic'))
    const { dialog, onClose, title } = shown(GOOD)
    await waitFor(() => expect(title().value).not.toBe(''))
    const field = within(dialog).getByRole('textbox', { name: 'When the issue is filed, paste its number or its address here' })
    fireEvent.change(field, { target: { value: 'https://github.com/someone/else/issues/95' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('That is not the number or the address of an issue of wordado/wordado.')
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '#95' } })
    expect(within(dialog).queryByRole('alert')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Not kept: no such topic')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('with no repository set, has no link, and offers the text to copy', async () => {
    const { dialog, text } = shown(GOOD, { repo: '' })
    await waitFor(() => expect(text().value).not.toBe(''))
    expect(within(dialog).queryByRole('link', { name: 'Open on GitHub' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Copy the text' })).toBeTruthy()
  })
})
