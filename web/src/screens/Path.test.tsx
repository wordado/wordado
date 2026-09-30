import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { DAY_MS, Grade } from '@wordado/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { Path } from './Path'

afterEach(cleanup)

const unit = (title: string) => screen.getByRole('heading', { name: title }).closest('li')!

/** Opens a word's ⋯ menu, where setting it aside and bringing it back live. */
const wordMenu = (row: HTMLElement, headword: string) => fireEvent.click(within(row).getByRole('button', { name: `Word actions: ${headword}` }))

describe('Path', () => {
  it('shows the first unit current and the rest locked before any answer', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    expect(within(unit('People and greetings')).getByText('Current')).toBeTruthy()
    expect(within(unit('People and greetings')).getByText('0 of 20 started')).toBeTruthy()
    expect(within(unit('Food and drink')).getByText('Locked')).toBeTruthy()
    expect(screen.getByText('0 of 60 words learned well')).toBeTruthy()
  })

  it('shows the level as a bar, and offers to study from the current unit', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    const level = screen.getByRole('progressbar', { name: 'A1: 0 of 60 words learned well' })
    expect(level.getAttribute('aria-valuemax')).toBe('60')
    expect(within(unit('People and greetings')).getByRole('link', { name: 'Start studying' }).getAttribute('href')).toBe('/study')
    expect(within(unit('Food and drink')).queryByRole('link', { name: 'Start studying' })).toBeNull()
  })

  it('moves the current unit on once every word of the first is introduced', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 30 })
    renderWith(<Path />, ctx)
    await act(() => answerNew(ctx.client, ctx.env, 20))
    // Introduced is not complete: the unit is still being learned, so it stays in view.
    expect(within(unit('People and greetings')).getByText('20 of 20 started')).toBeTruthy()
    expect(within(unit('Food and drink')).getByText('Current')).toBeTruthy()
    expect(within(unit('Home and every day')).getByText('Locked')).toBeTruthy()
  })

  it('folds the finished units into one line that opens them', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 30 })
    await answerNew(ctx.client, ctx.env, 20)
    // A unit is complete once its words pass a review on a later day (spec §7.2).
    ctx.env.advance(2 * DAY_MS)
    await ctx.client.updateSettings({ reviewCap: 50 })
    for (const wordId of ctx.client.snapshot.plan!.reviews) {
      await ctx.client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
      ctx.env.advance(3_000)
    }
    renderWith(<Path />, ctx)
    expect(screen.queryByRole('heading', { name: 'People and greetings' })).toBeNull()
    const fold = screen.getByRole('button', { name: '1 unit complete' })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(fold)
    expect(within(unit('People and greetings')).getByText('Complete')).toBeTruthy()
  })

  it('opens the level being studied and lets it fold', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    const header = screen.getByRole('button', { name: /^A1/ })
    expect(header.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('heading', { name: 'People and greetings' })).toBeNull()
    // Folded, the level still says where it stands.
    expect(within(header).getByText('0 of 60 words learned well')).toBeTruthy()
    fireEvent.click(header)
    expect(screen.getByRole('heading', { name: 'People and greetings' })).toBeTruthy()
  })

  it('shows a level below the declared one as skipped, never as complete (spec §7.2)', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    renderWith(<Path />, ctx)
    expect(screen.getByText('Skipped: you placed above this level.')).toBeTruthy()
    // A1 is unlocked outright once A2 is declared, but is neither current nor complete/mastered.
    expect(within(unit('People and greetings')).getByText('Open')).toBeTruthy()
  })

  it('uses the pack’s own unit titles in Bulgarian', async () => {
    const ctx = await setup()
    renderWith(<Path />, { ...ctx, locale: 'bg' })
    expect(screen.getByRole('heading', { name: 'Хора и поздрави' })).toBeTruthy()
  })

  it('lists a unit’s words only once opened, and sets one aside before it is ever taught (spec §7.4)', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    const food = unit('Food and drink')
    // Closed by default: a unit's word list is not rendered (and does not subscribe to the snapshot) until opened.
    expect(within(food).queryAllByRole('listitem')).toHaveLength(0)
    // happy-dom toggles a <details> open on a click of its <summary>, firing the native `toggle` event.
    await act(async () => fireEvent.click(food.querySelector('summary')!))
    const words = within(food).getAllByRole('listitem')
    expect(words).toHaveLength(20)
    const first = words[0]!
    const headword = first.querySelector('[lang="en"]')!.textContent!
    expect(within(first).getByText('Not started')).toBeTruthy()
    // The actions sit behind the word's ⋯ button, which takes focus back once a choice is made (spec §11.1).
    expect(within(first).queryByRole('button', { name: `I know it: ${headword}` })).toBeNull()
    wordMenu(first, headword)
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: `I know it: ${headword}` })))
    expect(within(first).getByText('Known')).toBeTruthy()
    expect(document.activeElement).toBe(within(first).getByRole('button', { name: `Word actions: ${headword}` }))
    expect([...ctx.client.snapshot.flags.values()]).toEqual(['known'])
    wordMenu(first, headword)
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: `Bring back: ${headword}` })))
    expect(ctx.client.snapshot.flags.size).toBe(0)
    expect(within(first).getByText('Not started')).toBeTruthy()
  })

  it('shows a saved-failed alert beside the word when setting it aside fails (spec §11.1)', async () => {
    const ctx = await setup()
    vi.spyOn(ctx.client, 'setFlag').mockRejectedValue(new Error('disk full'))
    renderWith(<Path />, ctx)
    const food = unit('Food and drink')
    await act(async () => fireEvent.click(food.querySelector('summary')!))
    const first = within(food).getAllByRole('listitem')[0]!
    const headword = first.querySelector('[lang="en"]')!.textContent!
    wordMenu(first, headword)
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: `I know it: ${headword}` })))
    expect(within(first).getByRole('alert').textContent).toBe('Your change wasn’t saved: Something went wrong. Try again.')
    expect(ctx.client.snapshot.flags.size).toBe(0)
  })
})
