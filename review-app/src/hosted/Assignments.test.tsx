import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssignmentView, Progress } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { Assignments } from './Assignments'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

const progress = (over: Partial<Progress> = {}): Progress => ({ inScope: 741, decided: 212, changed: 0, submitted: 60, merged: 0, remaining: 469, ...over })
const assignment = (over: Partial<AssignmentView> = {}): AssignmentView => ({
  id: 7, reviewer: 'anna@example.com', reviewerName: 'Anna', queue: 'translation-de', files: '*', flaggedOnly: true, createdAt: 't', closedAt: null, progress: progress(), ...over,
})
const untouched = assignment({ id: 8, queue: 'title-de', progress: progress({ inScope: 8, decided: 0, submitted: 0, remaining: 8 }) })

async function show(list: AssignmentView[]) {
  vi.spyOn(hostedApi, 'assignments').mockResolvedValue(list)
  const onOpen = vi.fn()
  render(<Assignments onOpen={onOpen} />)
  await screen.findByRole('heading', { name: 'Your assignments' })
  // the page is named by its heading: one wording for both
  expect(screen.getByRole('region', { name: 'Your assignments' })).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'My assignments' })).toBeNull()
  return onOpen
}

describe('Assignments', () => {
  it('names an assignment in plain words, with its counts and Continue once something is decided', async () => {
    const onOpen = await show([assignment(), untouched])
    const row = (await screen.findByText('German translations · flagged rows')).closest('li')!
    expect(row.getAttribute('title')).toBe('translation-de')
    expect(within(row).getByText('741 rows · 212 decided · 60 submitted')).toBeTruthy()
    const button = within(row).getByRole('button', { name: 'Continue' })
    expect(button.className).toContain('primary')
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))
  })

  it('offers Start on an untouched assignment', async () => {
    await show([assignment(), untouched])
    const row = (await screen.findByText('German unit titles · flagged rows')).closest('li')!
    expect(row.getAttribute('title')).toBe('title-de')
    expect(within(row).getByText('8 rows · none decided yet')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Start' }).className).not.toContain('primary')
    expect(within(row).queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('leaves the zero parts out of the counts', async () => {
    await show([
      assignment({ id: 1, progress: progress({ inScope: 1, decided: 1, submitted: 0, remaining: 0 }) }),
      assignment({ id: 2, queue: 'level', progress: progress({ inScope: 21, decided: 0, submitted: 21, remaining: 0 }) }),
    ])
    expect(await screen.findByText('1 row · 1 decided')).toBeTruthy()
    const submitted = screen.getByText('21 rows · 21 submitted').closest('li')!
    expect(within(submitted).getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('draws the progress: the submitted part, then the decided part', async () => {
    await show([assignment({ progress: progress({ inScope: 200, decided: 50, submitted: 20, remaining: 130 }) })])
    const row = (await screen.findByText('German translations · flagged rows')).closest('li')!
    expect((row.querySelector('.progress > .submitted') as HTMLElement).style.width).toBe('10%')
    expect((row.querySelector('.progress > .decided') as HTMLElement).style.width).toBe('25%')
  })

  it('says so when nothing is assigned', async () => {
    await show([])
    expect(await screen.findByText('Nothing is assigned to you yet.')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('says so when there is no review data yet, and has nothing to open', async () => {
    const onOpen = await show([assignment({ progress: null })])
    expect(await screen.findByText('The review data is not available yet.')).toBeTruthy()
    const start = screen.getByRole<HTMLButtonElement>('button', { name: 'Start' })
    expect(start.disabled).toBe(true)
    fireEvent.click(start)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('names the keys under the list', async () => {
    await show([assignment()])
    expect(await screen.findByText(/1 accept, 2 keep, 3 edit, 4 drop, S skip/)).toBeTruthy()
  })

  it('shows the server’s message when the list cannot be loaded', async () => {
    vi.spyOn(hostedApi, 'assignments').mockRejectedValue(new Error('no database'))
    render(<Assignments onOpen={() => {}} />)
    expect((await screen.findByRole('status')).textContent).toBe('no database')
  })
})
