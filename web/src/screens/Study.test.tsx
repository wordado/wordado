import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
})
