import { act, cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { Progress } from './Progress'

afterEach(cleanup)

const stat = (label: string) => screen.getByText(label).nextElementSibling?.textContent

describe('Progress', () => {
  it('counts every live word by tier', async () => {
    const ctx = await setup()
    renderWith(<Progress />, ctx)
    expect(stat('New')).toBe('60')
    expect(stat('Mature')).toBe('0')
    await act(() => answerNew(ctx.client, ctx.env, 3))
    expect(stat('New')).toBe('57')
    expect(stat('Learning')).toBe('3')
  })

  it('says retention needs reviews before it shows a number (spec §8.3)', async () => {
    const ctx = await setup()
    renderWith(<Progress />, ctx)
    expect(screen.getByText('Not enough reviews yet.')).toBeTruthy()
  })

  it('shows level completion by CEFR band', async () => {
    const ctx = await setup()
    renderWith(<Progress />, ctx)
    expect(screen.getByText('0 of 60 words learned well')).toBeTruthy()
  })
})
