import { act, cleanup, screen } from '@testing-library/react'
import { DAY_MS } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { answerNew, fakeAudio, renderWith, setup } from '../test/fixtures'
import { Home } from './Home'

afterEach(cleanup)

describe('Home', () => {
  it('leads with today’s new words and starts a session', async () => {
    const ctx = await setup()
    renderWith(<Home />, ctx)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('10 new words')
    expect(screen.getByRole('link', { name: 'Start studying' }).getAttribute('href')).toBe('/study')
    expect(screen.getByText('Study today to start a streak.')).toBeTruthy()
    expect(screen.getByText('0 XP today, 0 in all')).toBeTruthy()
  })

  it('offers single-mode sessions, listening only when audio can play', async () => {
    const ctx = await setup()
    const { unmount } = renderWith(<Home />, ctx)
    expect(screen.getByRole('link', { name: 'Flashcards' }).getAttribute('href')).toBe('/study?mode=flashcard')
    expect(screen.getByRole('link', { name: 'Multiple choice' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Listening' })).toBeNull()
    unmount()
    renderWith(<Home />, { ...ctx, audio: fakeAudio({ streamable: () => true }) })
    expect(screen.getByRole('link', { name: 'Listening' }).getAttribute('href')).toBe('/study?mode=listening_select')
  })

  it('says the day is done, and points to practice, once today’s words are answered', async () => {
    const ctx = await setup()
    renderWith(<Home />, ctx)
    await act(() => answerNew(ctx.client, ctx.env, 10))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nothing left for today.')
    expect(screen.getByRole('link', { name: 'Practise words you know' }).getAttribute('href')).toBe('/practice')
    expect(screen.getByText(/1-day streak/).textContent).toContain('Today counts.')
    expect(screen.getByText('100 XP today, 100 in all')).toBeTruthy()
    expect(screen.getByText('XP is confirmed when your progress syncs.')).toBeTruthy()
  })

  it('shows the capped figure first and the whole backlog second, and says new words wait', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 10)
    ctx.env.advance(30 * DAY_MS)
    await ctx.client.updateSettings({ reviewCap: 3 })
    renderWith(<Home />, ctx)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('3 words to review')
    expect(screen.getByText('10 due in all. The rest wait for another day.')).toBeTruthy()
    expect(screen.getByText('New words wait until your reviews are under today’s limit.')).toBeTruthy()
  })

  it('speaks Bulgarian by default', async () => {
    const ctx = await setup()
    renderWith(<Home />, { ...ctx, locale: 'bg' })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('10 нови думи')
  })
})
