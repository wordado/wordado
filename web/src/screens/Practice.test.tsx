import { cleanup, screen } from '@testing-library/react'
import { corpusWordId, themeEntries } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { Practice } from './Practice'

afterEach(cleanup)

describe('Practice', () => {
  it('asks for a few new words first when none has been studied', async () => {
    const ctx = await setup()
    renderWith(<Practice />, ctx)
    expect(screen.getByText('Nothing to practise yet. Study a few new words first.')).toBeTruthy()
  })

  it('offers a practice run and the matching game, and says practice leaves the schedule alone', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Practice />, ctx)
    expect(screen.getByText('Practice doesn’t change when words come back for review.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Practise words you know' }).getAttribute('href')).toBe('/practice/words')
    expect(screen.getByRole('link', { name: 'Flashcards' }).getAttribute('href')).toBe('/practice/words?mode=flashcard')
    const matching = screen.getByRole('link', { name: 'Matching' })
    expect(matching.getAttribute('href')).toBe('/practice/matching')
    expect(matching.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(matching.getAttribute('aria-describedby')!)?.textContent).toBe('Match words with their translations')
    expect(screen.getByRole('heading', { name: 'Practise one way' })).toBeTruthy()
    expect(screen.getByText('Mixed practice')).toBeTruthy()
  })

  it('practises one unit: names it, carries it in every way to practise, and leads back to the path', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    const first = ctx.client.snapshot.corpus!.units[0]!
    renderWith(<Practice unit={first.unitId} />, ctx)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Practice')
    expect(screen.getByText('Unit: People and greetings')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Practise this unit' }).getAttribute('href')).toBe(`/practice/words?unit=${first.unitId}`)
    expect(screen.getByRole('link', { name: 'Flashcards' }).getAttribute('href')).toBe(`/practice/words?unit=${first.unitId}&mode=flashcard`)
    expect(screen.getByRole('link', { name: 'Multiple choice' }).getAttribute('href')).toBe(`/practice/words?unit=${first.unitId}&mode=multiple_choice`)
    expect(screen.getByRole('link', { name: 'Matching' }).getAttribute('href')).toBe(`/practice/matching?unit=${first.unitId}`)
    expect(screen.getByRole('link', { name: 'Back to the path' }).getAttribute('href')).toBe('/path')
  })

  it('names the unit in the interface language', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Practice unit={ctx.client.snapshot.corpus!.units[0]!.unitId} />, { ...ctx, locale: 'bg' })
    expect(screen.getByText('Урок: Хора и поздрави')).toBeTruthy()
  })

  it('falls back to practice over everything for an unknown unit and for a locked one', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    const locked = ctx.client.snapshot.corpus!.units[2]!
    for (const unit of ['nowhere', locked.unitId]) {
      renderWith(<Practice unit={unit} />, ctx)
      expect(screen.queryByText(/^Unit:/)).toBeNull()
      expect(screen.queryByRole('link', { name: 'Back to the path' })).toBeNull()
      expect(screen.getByRole('link', { name: 'Practise words you know' }).getAttribute('href')).toBe('/practice/words')
      expect(screen.getByRole('link', { name: 'Matching' }).getAttribute('href')).toBe('/practice/matching')
      cleanup()
    }
  })

  it('says there is nothing to practise in a unit with no started word, whatever is started elsewhere', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 30 })
    await answerNew(ctx.client, ctx.env, 20)
    renderWith(<Practice unit={ctx.client.snapshot.corpus!.units[1]!.unitId} />, ctx)
    expect(screen.getByText('Unit: Food and drink')).toBeTruthy()
    expect(screen.getByText('Nothing to practise yet. Study a few new words first.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Matching' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to the path' }).getAttribute('href')).toBe('/path')
  })

  it('practises a unit of a skipped level with nothing started, and says where its words are from (spec §7.2, §7.4)', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    const second = ctx.client.snapshot.corpus!.units[1]!
    renderWith(<Practice unit={second.unitId} />, ctx)
    expect(screen.getByText('Unit: Food and drink')).toBeTruthy()
    const line = screen.getByText('From a level you skipped: these words may be new to you.')
    expect(line.previousElementSibling?.textContent).toBe('Unit: Food and drink')
    expect(screen.queryByText('Nothing to practise yet. Study a few new words first.')).toBeNull()
    expect(screen.getByRole('link', { name: 'Practise this unit' }).getAttribute('href')).toBe(`/practice/words?unit=${second.unitId}`)
    expect(screen.getByRole('link', { name: 'Matching' }).getAttribute('href')).toBe(`/practice/matching?unit=${second.unitId}`)
    cleanup()
    // Practice over everything still has nothing, and says nothing of skipped levels.
    renderWith(<Practice />, ctx)
    expect(screen.getByText('Nothing to practise yet. Study a few new words first.')).toBeTruthy()
    expect(screen.queryByText('From a level you skipped: these words may be new to you.')).toBeNull()
  })

  it('does not speak of a skipped level on a unit of the learner’s own level, or on a theme', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Practice unit={ctx.client.snapshot.corpus!.units[0]!.unitId} />, ctx)
    expect(screen.queryByText('From a level you skipped: these words may be new to you.')).toBeNull()
    cleanup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    renderWith(<Practice theme="daily-life" />, ctx)
    expect(screen.getByText(/^Theme:/)).toBeTruthy()
    expect(screen.queryByText('From a level you skipped: these words may be new to you.')).toBeNull()
  })

  it('practises one theme: names it, carries it in every way to practise, and leads back to the themes', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ activeTheme: 'daily-life' })
    await answerNew(ctx.client, ctx.env, 5)
    await ctx.client.updateSettings({ activeTheme: null })
    renderWith(<Practice theme="daily-life" />, ctx)
    expect(screen.getByText('Theme: Daily life')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Practise this theme' }).getAttribute('href')).toBe('/practice/words?theme=daily-life')
    expect(screen.getByRole('link', { name: 'Flashcards' }).getAttribute('href')).toBe('/practice/words?theme=daily-life&mode=flashcard')
    expect(screen.getByRole('link', { name: 'Matching' }).getAttribute('href')).toBe('/practice/matching?theme=daily-life')
    expect(screen.getByRole('link', { name: 'Back to themes' }).getAttribute('href')).toBe('/themes')
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
    cleanup()
    renderWith(<Practice theme="daily-life" />, { ...ctx, locale: 'bg' })
    expect(screen.getByText('Тема: Всекидневие')).toBeTruthy()
  })

  it('falls back to practice over everything for an unknown theme, and lets a unit win over a theme', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Practice theme="nowhere" />, ctx)
    expect(screen.queryByText(/^Theme:/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Matching' }).getAttribute('href')).toBe('/practice/matching')
    cleanup()
    const first = ctx.client.snapshot.corpus!.units[0]!
    renderWith(<Practice unit={first.unitId} theme="daily-life" />, ctx)
    expect(screen.getByText('Unit: People and greetings')).toBeTruthy()
    expect(screen.queryByText(/^Theme:/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Matching' }).getAttribute('href')).toBe(`/practice/matching?unit=${first.unitId}`)
  })

  it('says there is nothing to practise in a theme with no started word', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    const theme = new Set(themeEntries(ctx.client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId)))
    expect([...ctx.client.snapshot.states.keys()].some((wordId) => theme.has(wordId))).toBe(false)
    renderWith(<Practice theme="daily-life" />, ctx)
    expect(screen.getByText('Theme: Daily life')).toBeTruthy()
    expect(screen.getByText('Nothing to practise yet. Study a few new words first.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to themes' })).toBeTruthy()
  })

  it('counts only words practice can use: with every started word set aside there is nothing to practise', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 2)
    for (const wordId of ctx.client.snapshot.states.keys()) await ctx.client.setFlag(wordId, 'known')
    renderWith(<Practice />, ctx)
    expect(screen.getByText('Nothing to practise yet. Study a few new words first.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Matching' })).toBeNull()
  })
})
