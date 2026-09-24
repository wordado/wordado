import { act, cleanup, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
  })

  it('uses the pack’s own unit titles in Bulgarian', async () => {
    const ctx = await setup()
    renderWith(<Path />, { ...ctx, locale: 'bg' })
    expect(screen.getByRole('heading', { name: 'Хора и поздрави' })).toBeTruthy()
  })
})
