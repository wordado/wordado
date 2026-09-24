import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { corpusWordId, themeEntries } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWith, setup } from '../test/fixtures'
import { Themes } from './Themes'

afterEach(cleanup)

describe('Themes', () => {
  it('lists only the themes big enough to offer, with their size', async () => {
    const ctx = await setup()
    renderWith(<Themes />, ctx)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Daily life'])
    expect(screen.getByText('25 words')).toBeTruthy()
  })

  it('makes a theme’s words come first, and clears it again', async () => {
    const ctx = await setup()
    renderWith(<Themes />, ctx)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Study this theme' })))
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
