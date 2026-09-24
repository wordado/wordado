import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWith, setup } from '../test/fixtures'
import { Study } from './Study'

afterEach(cleanup)

describe('Study', () => {
  it('starts a run in the chosen mode', async () => {
    const ctx = await setup()
    renderWith(<Study kind="session" mode="flashcard" />, ctx)
    expect(await screen.findByRole('button', { name: 'Show answer' })).toBeTruthy()
  })

  it('says so when there is nothing to study', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 0 })
    renderWith(<Study kind="session" mode={null} />, ctx)
    expect(await screen.findByText('Nothing to study right now.')).toBeTruthy()
  })

  it('shows the error instead of loading forever when the run cannot start', async () => {
    const ctx = await setup()
    vi.spyOn(ctx.client, 'startSession').mockRejectedValue(new Error('database is locked'))
    renderWith(<Study kind="session" mode="flashcard" />, ctx)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Your answer wasn’t saved: Something went wrong. Try again.')
  })
})
