import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
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

describe('Home: the onboarding question (spec §8.6)', () => {
  it('asks what English is for, once nothing is studied, and makes the chosen theme come first', async () => {
    const ctx = await setup()
    renderWith(<Home />, ctx)
    const question = screen.getByRole('group', { name: 'What do you want English for?' })
    await act(async () => fireEvent.click(within(question).getByRole('button', { name: 'Daily life' })))
    expect(ctx.client.snapshot.settings.activeTheme).toBe('daily-life')
    expect(screen.queryByRole('group', { name: 'What do you want English for?' })).toBeNull()
  })

  it('can be skipped, and is gone once a word is studied', async () => {
    const ctx = await setup()
    const { unmount } = renderWith(<Home />, ctx)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.queryByRole('group', { name: 'What do you want English for?' })).toBeNull()
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
    unmount()
    await answerNew(ctx.client, ctx.env, 1)
    renderWith(<Home />, ctx)
    expect(screen.queryByRole('group', { name: 'What do you want English for?' })).toBeNull()
  })
})

describe('Home: listening follows the connection and the audio setting (spec §9.3, §11.1)', () => {
  it('drops listening when the device goes offline with nothing cached, and offers it again online', async () => {
    const ctx = await setup()
    const online = { value: true }
    Object.defineProperty(navigator, 'onLine', { get: () => online.value, configurable: true })
    renderWith(<Home />, { ...ctx, audio: fakeAudio({ streamable: () => navigator.onLine }) })
    expect(screen.getByRole('link', { name: 'Listening' })).toBeTruthy()
    online.value = false
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.queryByRole('link', { name: 'Listening' })).toBeNull()
    online.value = true
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.getByRole('link', { name: 'Listening' })).toBeTruthy()
  })

  it('never offers listening with audio switched off', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ audio: false })
    renderWith(<Home />, { ...ctx, audio: fakeAudio({ streamable: () => true }) })
    expect(screen.queryByRole('link', { name: 'Listening' })).toBeNull()
  })
})
