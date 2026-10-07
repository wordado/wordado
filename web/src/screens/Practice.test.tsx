import { cleanup, screen } from '@testing-library/react'
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
})
