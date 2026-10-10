import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { ITEM_SETTLE_MS } from '@wordado/client-data'
import { corpusWordId, DAY_MS, Grade, themeEntries } from '@wordado/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { Study } from './Study'

afterEach(cleanup)

/**
 * Shows a flashcard's answer and waits until it is on screen. The run arrives from a promise, so the screen's
 * subscription to it (a passive effect) may start a moment after the card is drawn: an answer revealed in that
 * moment reaches the screen one render later, and a lookup made at once would not find it (issue #112).
 */
async function showAnswer(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
  await screen.findByRole('button', { name: /Again/ })
}

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
      await showAnswer()
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

  it('practises a unit of a skipped level from words never started, starts none, and ends as a unit’s practice does', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    const second = ctx.client.snapshot.corpus!.units[1]!
    const before = ctx.client.snapshot
    renderWith(<Study kind="practice" mode="flashcard" unit={second.unitId} />, ctx)
    expect((await screen.findByRole('progressbar', { name: 'Session progress' })).getAttribute('aria-valuemax')).toBe('10')
    const headwords = second.wordIds.map((wordId) => ctx.client.entry(wordId)!.headword)
    // Setting a word aside works with no review state: the flag is the learner's, not the schedule's.
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    // The menu opens on a later render: wait for its button.
    const notNow = await screen.findByRole('button', { name: 'Not now' })
    await act(async () => fireEvent.click(notNow))
    for (let i = 0; i < 9; i += 1) {
      expect(headwords).toContain(document.querySelector('.card [lang="en"]')!.textContent)
      ctx.env.advance(ITEM_SETTLE_MS)
      await showAnswer()
      ctx.env.advance(ITEM_SETTLE_MS)
      await act(async () => fireEvent.click(screen.getByRole('button', { name: /Good/ })))
    }
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Practice complete')
    expect(screen.getByText('You answered 9 words.')).toBeTruthy()
    expect(screen.getByText('1 word set aside. You can bring it back in settings.')).toBeTruthy()
    // Nothing is said to be unlocked or to count for the day's new words; nothing was started.
    expect(screen.queryByText(/^New unit open/)).toBeNull()
    expect(ctx.client.snapshot.states.size).toBe(0)
    expect(ctx.client.snapshot.plan).toEqual(before.plan)
    expect(ctx.client.snapshot.progress!.levels.A1).toEqual({ kind: 'skipped' })
    expect(ctx.client.snapshot.flags.size).toBe(1)
    const links = [...document.querySelectorAll('.done-actions a')].map((a) => [a.textContent, a.getAttribute('href'), a.classList.contains('primary')])
    expect(links).toEqual([
      ['Back to the path', '/path', true],
      ['Practise more', `/practice?unit=${second.unitId}`, false],
    ])
  })

  it('practises a theme whole, labels the words never started, and ends with the way back to the themes', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ activeTheme: 'daily-life' })
    await answerNew(ctx.client, ctx.env, 3)
    await ctx.client.updateSettings({ activeTheme: null })
    await answerNew(ctx.client, ctx.env, 7)
    ctx.env.advance(3_600_000)
    const states = ctx.client.snapshot.states
    renderWith(<Study kind="practice" mode="flashcard" theme="daily-life" />, ctx)
    // Three of the theme's words are started; the run is a full one all the same.
    expect((await screen.findByRole('progressbar', { name: 'Session progress' })).getAttribute('aria-valuemax')).toBe('10')
    const entries = themeEntries(ctx.client.snapshot.corpus!, 'daily-life')
    let fresh = 0
    for (let i = 0; i < 10; i += 1) {
      const entry = entries.find((e) => e.headword === document.querySelector('.card [lang="en"]')!.textContent)!
      const started = states.has(corpusWordId(entry.entryId))
      // "New to you" on a word never started, from the prompt on; never on a started one.
      expect(screen.queryByText('New to you') !== null).toBe(!started)
      if (!started) fresh += 1
      ctx.env.advance(ITEM_SETTLE_MS)
      await showAnswer()
      expect(screen.queryByText('New to you') !== null).toBe(!started)
      // "Learn this word" goes with the label.
      expect(screen.queryByRole('button', { name: `Learn this word: ${entry.headword}` }) !== null).toBe(!started)
      ctx.env.advance(ITEM_SETTLE_MS)
      await act(async () => fireEvent.click(screen.getByRole('button', { name: /Good/ })))
    }
    expect(fresh).toBeGreaterThanOrEqual(7)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Practice complete')
    const links = [...document.querySelectorAll('.done-actions a')].map((a) => [a.textContent, a.getAttribute('href'), a.classList.contains('primary')])
    expect(links).toEqual([
      ['Back to themes', '/themes', true],
      ['Practise more', '/practice?theme=daily-life', false],
    ])
    expect(ctx.client.snapshot.states).toEqual(states)
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
  })

  describe('"Study this theme" when a theme’s practice ends (spec §8.9)', () => {
    async function practiseTheme(ctx: Awaited<ReturnType<typeof setup>>, props: { unit?: string; theme?: string } = { theme: 'daily-life' }) {
      renderWith(<Study kind="practice" mode="flashcard" {...props} />, ctx)
      await screen.findByRole('progressbar', { name: 'Session progress' })
    }
    const stop = () => act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    const offer = () => screen.queryByRole('button', { name: /^Study this theme/ })

    it('is offered after the practice of a theme that is not being studied and has words to start; chosen, it sets the theme and says so', async () => {
      const ctx = await setup()
      await practiseTheme(ctx)
      // Mark the first word to learn on the way.
      const word = document.querySelector('.card [lang="en"]')!.textContent
      ctx.env.advance(ITEM_SETTLE_MS)
      await showAnswer()
      await act(async () => fireEvent.click(screen.getByRole('button', { name: `Learn this word: ${word}` })))
      await stop()
      expect(screen.getByText('1 word will come up in your next sessions.')).toBeTruthy()
      const button = screen.getByRole('button', { name: 'Study this theme: Daily life' })
      expect(button.textContent).toBe('Study this theme')
      // After the two ways on that were always there.
      expect([...document.querySelectorAll('.done-actions > *')].map((el) => el.textContent)).toEqual(['Back to themes', 'Practise more', 'Study this theme'])
      expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
      await act(async () => fireEvent.click(button))
      // Exactly what "Study this next" does: the theme is the study theme, and its words are the day's new words.
      expect(ctx.client.snapshot.settings.activeTheme).toBe('daily-life')
      const theme = themeEntries(ctx.client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId))
      const planned = ctx.client.snapshot.plan!.newWords
      expect(planned).toHaveLength(10)
      expect(planned.every((wordId) => theme.includes(wordId))).toBe(true)
      // The marked word is served once, first, though the theme would serve it too.
      expect(ctx.client.entry(planned[0]!)!.headword).toBe(word)
      expect(new Set(planned).size).toBe(10)
      // The learner stays: the offer gives way to a line that says it, which takes the focus the button had.
      expect(offer()).toBeNull()
      const line = screen.getByText('Now studying: Daily life')
      expect(document.activeElement).toBe(line)
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Practice complete')
      expect(screen.getByText('1 word will come up in your next sessions.')).toBeTruthy()
      expect([...document.querySelectorAll('.done-actions > *')].map((el) => el.textContent)).toEqual(['Back to themes', 'Practise more'])
    })

    it('says so when the choice cannot be saved, keeps the offer, and takes the theme up on the next try', async () => {
      const ctx = await setup()
      await practiseTheme(ctx)
      await stop()
      const failing = vi.spyOn(ctx.client, 'updateSettings').mockRejectedValueOnce(new Error('database is locked'))
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Study this theme: Daily life' })))
      expect(screen.getByRole('alert').textContent).toBe('Your change wasn’t saved: Something went wrong. Try again.')
      expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
      expect(screen.queryByText('Now studying: Daily life')).toBeNull()
      expect(failing).toHaveBeenCalledTimes(1)
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Study this theme: Daily life' })))
      expect(ctx.client.snapshot.settings.activeTheme).toBe('daily-life')
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByText('Now studying: Daily life')).toBeTruthy()
    })

    it('is not offered when the theme is already the one being studied', async () => {
      const ctx = await setup()
      await ctx.client.updateSettings({ activeTheme: 'daily-life' })
      await practiseTheme(ctx)
      await stop()
      expect(screen.getByRole('link', { name: 'Back to themes' })).toBeTruthy()
      expect(offer()).toBeNull()
      expect(screen.queryByText('Now studying: Daily life')).toBeNull()
    })

    it('is not offered when every word of the theme is started or set aside: there is nothing left to study', async () => {
      const ctx = await setup()
      await ctx.client.updateSettings({ activeTheme: 'daily-life', newWordLimit: 30 })
      await answerNew(ctx.client, ctx.env, 24)
      await ctx.client.updateSettings({ activeTheme: null })
      const last = themeEntries(ctx.client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId)).find((wordId) => !ctx.client.snapshot.states.has(wordId))!
      await ctx.client.setFlag(last, 'known')
      ctx.env.advance(3_600_000)
      await practiseTheme(ctx)
      expect(screen.queryByText('New to you')).toBeNull()
      await stop()
      expect(screen.getByRole('link', { name: 'Back to themes' })).toBeTruthy()
      expect(offer()).toBeNull()
    })

    it('is not offered after a unit’s practice, or after practice over everything', async () => {
      const ctx = await setup()
      await answerNew(ctx.client, ctx.env, 5)
      ctx.env.advance(3_600_000)
      for (const props of [{ unit: ctx.client.snapshot.corpus!.units[0]!.unitId }, {}]) {
        await practiseTheme(ctx, props)
        await stop()
        expect(screen.getByRole('link', { name: 'Practise more' })).toBeTruthy()
        expect(offer()).toBeNull()
        cleanup()
      }
    })

    it('speaks the interface language', async () => {
      const ctx = await setup()
      renderWith(<Study kind="practice" mode="flashcard" theme="daily-life" />, { ...ctx, locale: 'de' })
      // Once the run has started: its first word is one never started.
      expect(await screen.findByText('Neu für dich')).toBeTruthy()
      await act(async () => fireEvent.click(document.querySelector<HTMLButtonElement>('.study-close')!))
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dieses Thema lernen: Daily life' })))
      expect(screen.getByText('Du lernst jetzt: Daily life')).toBeTruthy()
    })
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

  it('says the words are being got ready while the run starts, with a bar that claims no share', async () => {
    const ctx = await setup()
    let start!: () => void
    vi.spyOn(ctx.client, 'startSession').mockImplementation(() => new Promise<string[]>((resolve) => (start = () => resolve([]))))
    renderWith(<Study kind="session" mode="flashcard" />, ctx)
    expect(screen.getByRole('status').textContent).toBe('Getting your words ready…')
    const bar = screen.getByRole('progressbar', { name: 'Getting your words ready…' })
    expect(bar.hasAttribute('aria-valuenow')).toBe(false)
    await act(async () => start())
    expect(await screen.findByRole('button', { name: 'Show answer' })).toBeTruthy()
    expect(screen.queryByRole('progressbar', { name: 'Getting your words ready…' })).toBeNull()
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
