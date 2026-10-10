import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedbackWeek, FeedbackWeekParagraph } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { AdminFeedbackWeek } from './AdminFeedbackWeek'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

const PARAGRAPH = 'Twelve messages came, most of them about the sound playing twice.'
const week = (over: Partial<FeedbackWeek> = {}): FeedbackWeek => ({
  since: 0,
  until: 1,
  read: 12,
  byCategory: { bug: 5, idea: 4, question: 1, praise: 1, junk: 1 },
  blockingBugs: 2,
  topTopics: [{ id: 14, title: 'Sound plays twice on phones', count: 4 }, { id: 15, title: 'Number of new words a day', count: 3 }],
  blocking: [{ id: 14, title: 'Sound plays twice on phones', count: 1 }, { id: null, title: 'No topic', count: 1 }],
  newTopics: [{ id: 16, title: 'A dark theme' }],
  paragraph: PARAGRAPH,
  ...over,
})

function shown(first: FeedbackWeek | Error, written: FeedbackWeekParagraph | Error | Promise<FeedbackWeekParagraph> = { paragraph: PARAGRAPH, why: null }, props: { aiOn?: boolean } = {}) {
  const read = vi.spyOn(hostedApi.admin, 'feedbackWeek')
  if (first instanceof Error) read.mockRejectedValue(first)
  else read.mockResolvedValue(first)
  const write = vi.spyOn(hostedApi.admin, 'feedbackWeekParagraph')
  if (written instanceof Error) write.mockRejectedValue(written)
  else write.mockImplementation(async () => written)
  const onTopic = vi.fn()
  const view = render(<AdminFeedbackWeek aiOn={props.aiOn ?? true} dailyCalls={200} version={0} onTopic={onTopic} />)
  const again = (version: number, aiOn = props.aiOn ?? true) => view.rerender(<AdminFeedbackWeek aiOn={aiOn} dailyCalls={200} version={version} onTopic={onTopic} />)
  return { read, write, onTopic, again }
}
const section = () => screen.findByRole('region', { name: 'This week' })

describe('AdminFeedbackWeek: the week at the top of the Feedback tab (spec 2026-10-10 §3.4)', () => {
  it('shows the paragraph as the AI’s, how many messages it read, and the counts by category', async () => {
    const { write } = shown(week())
    const region = await section()
    expect(within(region).getByText('Written by the AI')).toBeTruthy()
    expect(within(region).getByText(PARAGRAPH)).toBeTruthy()
    expect(within(region).getByText('12 messages read by the AI in the last 7 days')).toBeTruthy()
    const counts = within(within(region).getByRole('list', { name: 'By the AI’s category' })).getAllByRole('listitem').map((li) => li.textContent)
    expect(counts).toEqual(['Bug 5', 'Idea 4', 'Question 1', 'Praise 1', 'Junk 1'])
    // A kept paragraph is not asked for again.
    expect(write).not.toHaveBeenCalled()
  })

  it('lists the topics with the most messages, the blocking bugs and the new topics; a topic opens By topic at it', async () => {
    const { onTopic } = shown(week())
    const region = await section()
    const most = within(region).getByRole('list', { name: 'Most messages' })
    expect(within(most).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Sound plays twice on phones 4', 'Number of new words a day 3'])
    const blocking = within(region).getByRole('list', { name: 'Blocking bugs' })
    expect(within(blocking).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Sound plays twice on phones 1', 'No topic 1'])
    // Bugs in no topic have nowhere to open.
    expect(within(blocking).getAllByRole('button')).toHaveLength(1)
    const fresh = within(region).getByRole('list', { name: 'New topics' })
    expect(within(fresh).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['A dark theme'])
    fireEvent.click(within(most).getByRole('button', { name: 'Number of new words a day' }))
    expect(onTopic).toHaveBeenCalledWith(15)
    fireEvent.click(within(fresh).getByRole('button', { name: 'A dark theme' }))
    expect(onTopic).toHaveBeenLastCalledWith(16)
  })

  it('says "1 message", and leaves out a list that would be empty', async () => {
    shown(week({ read: 1, byCategory: { bug: 0, idea: 1, question: 0, praise: 0, junk: 0 }, blockingBugs: 0, topTopics: [], blocking: [], newTopics: [] }))
    const region = await section()
    expect(within(region).getByText('1 message read by the AI in the last 7 days')).toBeTruthy()
    for (const name of ['Most messages', 'Blocking bugs', 'New topics']) expect(within(region).queryByRole('list', { name })).toBeNull()
  })

  it('is not there while the AI has read nothing of the last seven days, and asks for no paragraph', async () => {
    const { read, write } = shown(week({ read: 0, paragraph: null }))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('region', { name: 'This week' })).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('is not there when the numbers cannot be read: the tab under it goes on', async () => {
    const { read } = shown(new Error('away'))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('region', { name: 'This week' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('asks for the paragraph once when none is kept, and shows the numbers while it is on its way', async () => {
    let done: (answer: FeedbackWeekParagraph) => void = () => undefined
    const { write, again } = shown(week({ paragraph: null }), new Promise<FeedbackWeekParagraph>((resolve) => (done = resolve)))
    const region = await section()
    expect(within(region).getByText('12 messages read by the AI in the last 7 days')).toBeTruthy()
    // (Asked for once the numbers are shown: the line comes a moment after them.)
    expect((await within(region).findByText('The AI is writing about the week…')).getAttribute('role')).toBe('status')
    expect(within(region).queryByText('Written by the AI')).toBeNull()
    done({ paragraph: PARAGRAPH, why: null })
    expect(await within(region).findByText(PARAGRAPH)).toBeTruthy()
    expect(within(region).getByText('Written by the AI')).toBeTruthy()
    // The numbers read again (a page was read by the AI): the paragraph is not asked for a second time.
    again(1)
    await waitFor(() => expect(hostedApi.admin.feedbackWeek).toHaveBeenCalledTimes(2))
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('keeps the numbers when the paragraph fails, says so in one line, and does not ask again by itself', async () => {
    const { write, again } = shown(week({ paragraph: null }), { paragraph: null, why: 'late' })
    const region = await section()
    expect((await within(region).findByText('The AI wrote nothing about the week this time (it took too long).')).getAttribute('role')).toBe('status')
    expect(within(region).getByText('12 messages read by the AI in the last 7 days')).toBeTruthy()
    expect(within(region).queryByText('Written by the AI')).toBeNull()
    again(1)
    await waitFor(() => expect(hostedApi.admin.feedbackWeek).toHaveBeenCalledTimes(2))
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('says when the day’s limit is why, and when the request itself failed', async () => {
    shown(week({ paragraph: null }), { paragraph: null, why: 'limit' })
    expect(await within(await section()).findByText('Today’s limit of 200 AI calls is reached: nothing is written about the week.')).toBeTruthy()
    cleanup()
    vi.restoreAllMocks()
    shown(week({ paragraph: null }), new Error('away'))
    expect(await within(await section()).findByText('The AI wrote nothing about the week this time (it could not be reached).')).toBeTruthy()
  })

  it('asks for no paragraph while the AI help is off: the numbers of what it read before stay', async () => {
    const { write } = shown(week({ paragraph: null }), undefined, { aiOn: false })
    const region = await section()
    expect(within(region).getByText('12 messages read by the AI in the last 7 days')).toBeTruthy()
    expect(write).not.toHaveBeenCalled()
    expect(within(region).queryByRole('status')).toBeNull()
  })
})
