import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { corpusWordId, Grade, themeEntries } from '@wordado/core'
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

  it('needs five started words of the unit when practising one unit', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 30 })
    await answerNew(ctx.client, ctx.env, 24)
    const second = ctx.client.snapshot.corpus!.units[1]!
    renderWith(<Matching unit={second.unitId} />, ctx)
    expect(screen.getByText('Matching needs five started words from this unit.')).toBeTruthy()
    expect(screen.queryByText('Learn a few words first: matching needs five.')).toBeNull()
    expect(screen.getByText('Unit: Food and drink')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to practice' }).getAttribute('href')).toBe(`/practice?unit=${second.unitId}`)
  })

  it('deals a unit’s board from that unit’s words only, and leads back to that unit’s practice', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 30 })
    await answerNew(ctx.client, ctx.env, 25)
    const second = ctx.client.snapshot.corpus!.units[1]!
    const states = ctx.client.snapshot.states
    renderWith(<Matching unit={second.unitId} />, ctx)
    const started = second.wordIds.filter((wordId) => states.has(wordId))
    expect(started).toHaveLength(5)
    expect(new Set(english().map((b) => `c:${b.dataset.entry!}`))).toEqual(new Set(started))
    expect(screen.getByRole('link', { name: 'Back to practice' }).getAttribute('href')).toBe(`/practice?unit=${second.unitId}`)
    for (const button of english()) {
      await click(button)
      await click(translationFor(button.dataset.entry!))
    }
    expect(document.querySelector('.done-actions a')?.getAttribute('href')).toBe(`/practice?unit=${second.unitId}`)
    expect(ctx.client.snapshot.states).toEqual(states)
    // Play again deals the same unit.
    await click(screen.getByRole('button', { name: 'Play again' }))
    expect(new Set(english().map((b) => `c:${b.dataset.entry!}`))).toEqual(new Set(started))
  })

  it('needs five started words of the theme when practising one theme, then deals only that theme’s words', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ activeTheme: 'daily-life' })
    await answerNew(ctx.client, ctx.env, 4)
    await ctx.client.updateSettings({ activeTheme: null })
    await answerNew(ctx.client, ctx.env, 6)
    const theme = new Set(themeEntries(ctx.client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId)))
    const started = () => [...ctx.client.snapshot.states.keys()].filter((wordId) => theme.has(wordId))
    expect(started()).toHaveLength(4)
    renderWith(<Matching theme="daily-life" />, ctx)
    expect(screen.getByText('Matching needs five started words from this theme.')).toBeTruthy()
    expect(screen.getByText('Theme: Daily life')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to practice' }).getAttribute('href')).toBe('/practice?theme=daily-life')
    cleanup()
    const fifth = [...theme].find((wordId) => !ctx.client.snapshot.states.has(wordId))!
    await ctx.client.answer({ wordId: fifth, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    renderWith(<Matching theme="daily-life" />, ctx)
    expect(new Set(english().map((b) => `c:${b.dataset.entry!}`))).toEqual(new Set<string>(started()))
    expect(screen.getByRole('link', { name: 'Back to practice' }).getAttribute('href')).toBe('/practice?theme=daily-life')
  })

  it('plays over everything for a locked unit', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Matching unit={ctx.client.snapshot.corpus!.units[2]!.unitId} />, ctx)
    expect(english()).toHaveLength(5)
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
