import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
    expect(english().every((b) => b.disabled && b.textContent!.includes('Matched'))).toBe(true)
    // Matching is practice: the schedule is untouched (spec §8.1).
    expect(ctx.client.snapshot.states).toEqual(states)
    await click(screen.getByRole('button', { name: 'Play again' }))
    expect(english().every((b) => !b.disabled)).toBe(true)
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
