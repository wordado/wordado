import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { corpusWordId, themeEntries } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { Themes } from './Themes'

afterEach(cleanup)

describe('Themes', () => {
  it('lists only the themes big enough to offer, with their size', async () => {
    const ctx = await setup()
    renderWith(<Themes />, ctx)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Daily life'])
    expect(screen.getByText('0 of 25 words started')).toBeTruthy()
  })

  it('shows how much of each theme is started, as a bar', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Themes />, ctx)
    const started = themeEntries(ctx.client.snapshot.corpus!, 'daily-life').filter((e) => ctx.client.snapshot.states.has(corpusWordId(e.entryId))).length
    const bar = screen.getByRole('progressbar', { name: `Daily life: ${started} of 25 words started` })
    expect(bar.getAttribute('aria-valuenow')).toBe(String(started))
    expect(bar.getAttribute('aria-valuemax')).toBe('25')
  })

  it('makes a theme’s words come first, and clears it again', async () => {
    const ctx = await setup()
    renderWith(<Themes />, ctx)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Study this theme: Daily life' })))
    expect(ctx.client.snapshot.settings.activeTheme).toBe('daily-life')
    const theme = new Set(themeEntries(ctx.client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId)))
    expect(ctx.client.snapshot.plan!.newWords.every((w) => theme.has(w))).toBe(true)
    expect(screen.getByText('Studying now')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Back to the path' })))
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
  })

  it('names themes from the pack in Bulgarian', async () => {
    const ctx = await setup()
    renderWith(<Themes />, { ...ctx, locale: 'bg' })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Всекидневие')
  })
})
