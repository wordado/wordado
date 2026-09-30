import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { Matching } from './Matching'

afterEach(cleanup)

const english = () => [...document.querySelectorAll<HTMLButtonElement>('[data-side="left"] button')]
const translationFor = (entryId: string) => document.querySelector<HTMLButtonElement>(`[data-side="right"] button[data-entry="${entryId}"]`)!
const click = (button: HTMLElement) => act(async () => void fireEvent.click(button))

describe('Matching', () => {
  it('needs five studied words', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 4)
    renderWith(<Matching />, ctx)
    expect(screen.getByText('Learn a few words first: matching needs five.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to practice' }).getAttribute('href')).toBe('/practice')
  })

  it('heads the translation column with the pack’s language', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Matching />, ctx)
    expect(screen.getByRole('heading', { name: 'Bulgarian' })).toBeTruthy()
  })

  it('shows pairs matched as a bar and a count, and offers the way back to practice', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Matching />, ctx)
    const bar = screen.getByRole('progressbar', { name: 'Pairs matched' })
    expect(bar.getAttribute('aria-valuenow')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('5')
    const first = english()[0]!
    await click(first)
    await click(translationFor(first.dataset.entry!))
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(document.querySelector('.study-count')?.textContent).toBe('1 / 5')
    expect(screen.getByRole('link', { name: 'Back to practice' }).getAttribute('href')).toBe('/practice')
  })

  it('marks both tiles of a wrong pair', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Matching />, ctx)
    const [first, second] = english()
    await click(first!)
    await click(translationFor(second!.dataset.entry!))
    expect(first!.classList.contains('is-miss')).toBe(true)
    expect(translationFor(second!.dataset.entry!).classList.contains('is-miss')).toBe(true)
  })

  it('pairs words with translations, announces a wrong pair, and finishes the board', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    const states = ctx.client.snapshot.states
    renderWith(<Matching />, ctx)
    const left = english()
    expect(left).toHaveLength(5)
    const second = left[1]!.dataset.entry!

    await click(left[0]!)
    expect(left[0]!.getAttribute('aria-pressed')).toBe('true')
    await click(translationFor(second))
    expect(screen.getByRole('status').textContent).toMatch(/^✗ .+ and .+ aren’t a pair\.$/)

    for (const button of english()) {
      await click(button)
      await click(translationFor(button.dataset.entry!))
    }
    expect(screen.getByRole('status').textContent).toBe('✓ All pairs matched.')
    // The board gives way to the end card: Play again, or back to practice.
    expect(english()).toHaveLength(0)
    expect(document.querySelector('.done-card')).not.toBeNull()
    expect(document.querySelector('.done-actions a')?.textContent).toBe('Back to practice')
    expect(document.querySelector('.done-actions a')?.getAttribute('href')).toBe('/practice')
    // Matching is practice: the schedule is untouched (spec §8.1).
    expect(ctx.client.snapshot.states).toEqual(states)
    await click(screen.getByRole('button', { name: 'Play again' }))
    expect(english()).toHaveLength(5)
    expect(english().every((b) => !b.disabled)).toBe(true)
  })

  it('fetches what comes next once the board is done, and not before (spec §9.3)', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    const afterRun = vi.fn()
    renderWith(<Matching />, { ...ctx, afterRun })
    for (const button of english()) {
      await click(button)
      expect(afterRun).not.toHaveBeenCalled()
      await click(translationFor(button.dataset.entry!))
    }
    expect(afterRun).toHaveBeenCalledTimes(1)
  })

  it('moves focus to the next unmatched word after a match, and to Play again once the board is done', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Matching />, ctx)
    const order = english()

    for (const [i, button] of order.entries()) {
      button.focus()
      await click(button)
      const translation = translationFor(button.dataset.entry!)
      translation.focus()
      await click(translation)
      if (i < order.length - 1) {
        expect(document.activeElement).toBe(english().find((b) => !b.disabled))
      } else {
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Play again' }))
      }
    }
  })
})
