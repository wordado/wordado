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
})
