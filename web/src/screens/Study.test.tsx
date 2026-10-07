import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { ITEM_SETTLE_MS } from '@wordado/client-data'
import { DAY_MS, Grade, themeEntries } from '@wordado/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
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

  it('practises one unit from that unit’s started words, without touching the schedule', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 30 })
    await answerNew(ctx.client, ctx.env, 23)
    // An hour on: started today, not due, so practice may serve them.
    ctx.env.advance(3_600_000)
    const second = ctx.client.snapshot.corpus!.units[1]!
    const states = ctx.client.snapshot.states
    renderWith(<Study kind="practice" mode="flashcard" unit={second.unitId} />, ctx)
    expect((await screen.findByRole('progressbar', { name: 'Session progress' })).getAttribute('aria-valuemax')).toBe('3')
    const headwords = second.wordIds.map((wordId) => ctx.client.entry(wordId)!.headword)
    for (let i = 0; i < 3; i += 1) {
      expect(headwords).toContain(document.querySelector('.card [lang="en"]')!.textContent)
      ctx.env.advance(ITEM_SETTLE_MS)
      fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
      ctx.env.advance(ITEM_SETTLE_MS)
      await act(async () => fireEvent.click(screen.getByRole('button', { name: /Again/ })))
    }
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Practice complete')
    expect(ctx.client.snapshot.states).toEqual(states)
    // The way on is that unit's practice; the way back, the path.
    const links = [...document.querySelectorAll('.done-actions a')].map((a) => [a.textContent, a.getAttribute('href'), a.classList.contains('primary')])
    expect(links).toEqual([
      ['Back to the path', '/path', true],
      ['Practise more', `/practice?unit=${second.unitId}`, false],
    ])
  })

  it('practises one theme from that theme’s started words, and ends with the way back to the themes', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ activeTheme: 'daily-life' })
    await answerNew(ctx.client, ctx.env, 3)
    await ctx.client.updateSettings({ activeTheme: null })
    await answerNew(ctx.client, ctx.env, 7)
    ctx.env.advance(3_600_000)
    const states = ctx.client.snapshot.states
    renderWith(<Study kind="practice" mode="flashcard" theme="daily-life" />, ctx)
    expect((await screen.findByRole('progressbar', { name: 'Session progress' })).getAttribute('aria-valuemax')).toBe('3')
    const headwords = themeEntries(ctx.client.snapshot.corpus!, 'daily-life').map((e) => e.headword)
    expect(headwords).toContain(document.querySelector('.card [lang="en"]')!.textContent)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    const links = [...document.querySelectorAll('.done-actions a')].map((a) => [a.textContent, a.getAttribute('href'), a.classList.contains('primary')])
    expect(links).toEqual([
      ['Back to themes', '/themes', true],
      ['Practise more', '/practice?theme=daily-life', false],
    ])
    expect(ctx.client.snapshot.states).toEqual(states)
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
  })

  it('never starts a practice run empty: with every started word due today, it practises them', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 6)
    ctx.env.advance(30 * DAY_MS)
    const first = ctx.client.snapshot.corpus!.units[0]!
    renderWith(<Study kind="practice" mode="flashcard" unit={first.unitId} />, ctx)
    expect((await screen.findByRole('progressbar', { name: 'Session progress' })).getAttribute('aria-valuemax')).toBe('6')
    expect(screen.queryByText('Nothing to study right now.')).toBeNull()
  })

  it('practises over everything for a locked unit, and ends as practice always has', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    const third = ctx.client.snapshot.corpus!.units[2]!
    await ctx.client.answer({ wordId: third.wordIds[0]!, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    ctx.env.advance(3_600_000)
    renderWith(<Study kind="practice" mode="flashcard" unit={third.unitId} />, ctx)
    expect((await screen.findByRole('progressbar', { name: 'Session progress' })).getAttribute('aria-valuemax')).toBe('6')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    const links = [...document.querySelectorAll('.done-actions a')].map((a) => [a.textContent, a.getAttribute('href')])
    expect(links).toEqual([
      ['Back to today', '/'],
      ['Practise more', '/practice'],
    ])
  })

  it('shows the error instead of loading forever when the run cannot start', async () => {
    const ctx = await setup()
    vi.spyOn(ctx.client, 'startSession').mockRejectedValue(new Error('database is locked'))
    renderWith(<Study kind="session" mode="flashcard" />, ctx)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Your answer wasn’t saved: Something went wrong. Try again.')
    // Focus mode hides the navigation: the failure offers the way back itself.
    expect(screen.getByRole('link', { name: 'Back to today' }).getAttribute('href')).toBe('/')
  })
})
