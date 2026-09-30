import { act, cleanup, screen } from '@testing-library/react'
import { DAY_MS, Grade } from '@wordado/core'
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

  it('shows the tiers as one bar, each segment named on hover, with the total', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 3)
    renderWith(<Progress />, ctx)
    expect(screen.getByText('60 in all')).toBeTruthy()
    // Only tiers that hold words get a segment; each says what it is when pointed at.
    const segments = [...document.querySelectorAll('.tier-bar span')].map((s) => s.getAttribute('data-tip'))
    expect(segments).toEqual(['New: 57', 'Learning: 3'])
  })

  it('gives streak and XP a tile each', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 10)
    renderWith(<Progress />, ctx)
    expect(stat('Streak')).toBe('1 day')
    expect(stat('XP today')).toBe('100')
    expect(stat('XP in all')).toBe('100')
    expect(stat('Freezes left')).toBe('2')
  })

  it('shows retention as one big figure once words are reviewed on a later day', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 3)
    ctx.env.advance(2 * DAY_MS)
    // A settings write rebuilds the day's plan, as the Home backlog test does; the reviews are then due.
    await ctx.client.updateSettings({ reviewCap: 50 })
    expect(ctx.client.snapshot.plan!.reviews.length).toBeGreaterThan(0)
    for (const wordId of ctx.client.snapshot.plan!.reviews) {
      await ctx.client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
      ctx.env.advance(3_000)
    }
    renderWith(<Progress />, ctx)
    expect(document.querySelector('.hero-figure')?.textContent).toBe('100%')
    expect(screen.getByText('over the last 30 days')).toBeTruthy()
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
