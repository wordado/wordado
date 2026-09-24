import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { Path } from './Path'

afterEach(cleanup)

const unit = (title: string) => screen.getByRole('heading', { name: title }).closest('li')!

describe('Path', () => {
  it('shows the first unit current and the rest locked before any answer', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    expect(within(unit('People and greetings')).getByText('Current')).toBeTruthy()
    expect(within(unit('People and greetings')).getByText('0 of 20 started')).toBeTruthy()
    expect(within(unit('Food and drink')).getByText('Locked')).toBeTruthy()
    expect(screen.getByText('0 of 60 words learned well')).toBeTruthy()
  })

  it('moves the current unit on once every word of the first is introduced', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 30 })
    renderWith(<Path />, ctx)
    await act(() => answerNew(ctx.client, ctx.env, 20))
    expect(within(unit('People and greetings')).getByText('20 of 20 started')).toBeTruthy()
    expect(within(unit('Food and drink')).getByText('Current')).toBeTruthy()
    expect(within(unit('Home and every day')).getByText('Locked')).toBeTruthy()
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
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: `I know it: ${headword}` })))
    expect(within(first).getByText('Known')).toBeTruthy()
    // The pressed button is gone: its replacement has focus (spec §11.1).
    expect(document.activeElement).toBe(within(first).getByRole('button', { name: `Bring back: ${headword}` }))
    expect([...ctx.client.snapshot.flags.values()]).toEqual(['known'])
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: `Bring back: ${headword}` })))
    expect(ctx.client.snapshot.flags.size).toBe(0)
    expect(document.activeElement).toBe(within(first).getByRole('button', { name: `I know it: ${headword}` }))
  })

  it('shows a saved-failed alert beside the word when setting it aside fails (spec §11.1)', async () => {
    const ctx = await setup()
    vi.spyOn(ctx.client, 'setFlag').mockRejectedValue(new Error('disk full'))
    renderWith(<Path />, ctx)
    const food = unit('Food and drink')
    await act(async () => fireEvent.click(food.querySelector('summary')!))
    const first = within(food).getAllByRole('listitem')[0]!
    const headword = first.querySelector('[lang="en"]')!.textContent!
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: `I know it: ${headword}` })))
    expect(within(first).getByRole('alert').textContent).toBe('Your change wasn’t saved: Something went wrong. Try again.')
    expect(ctx.client.snapshot.flags.size).toBe(0)
  })
})
