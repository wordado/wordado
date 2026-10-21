import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { ITEM_SETTLE_MS, type PlacementSource } from '@wordado/client-data'
import { leveledCorpus } from '@wordado/client-data/src/testing/sample'
import type { CefrLevel, Corpus } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWith, setup } from '../test/fixtures'
import { Placement } from './Placement'

afterEach(cleanup)

async function withBands() {
  const ctx = await setup()
  const corpus: Corpus = leveledCorpus(ctx.client.snapshot.corpus!, ['A1', 'A2', 'B1'])
  const source: PlacementSource = {
    corpus,
    setLevel: async (level: CefrLevel) => {
      await ctx.client.updateSettings({ declaredLevel: level })
    },
  }
  renderWith(<Placement source={source} />, ctx)
  return { ...ctx, corpus }
}

/** The option that is the shown word in English: the one whose translation, in the corpus the test was given, is shown. */
function rightAnswer(corpus: Corpus): HTMLElement {
  const prompt = document.querySelector('.card .prompt-text')!.textContent!
  const options = [...document.querySelectorAll<HTMLElement>('.study-actions .option')]
  return options.find((option) => {
    const headword = option.querySelector('.option-text')!.textContent
    return [...corpus.entries.values()].some((e) => e.headword === headword && prompt.includes(e.translations[0]!))
  })!
}

describe('Placement (spec §7.2)', () => {
  it('explains why it is not offered on the A1-only sample', async () => {
    const ctx = await setup()
    renderWith(<Placement />, ctx)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('The placement test isn’t available yet')
    expect(document.activeElement).toBe(heading)
    // The test is offered under Settings › Studying, so that is the way back.
    expect(screen.getByRole('link', { name: 'Back to settings' }).getAttribute('href')).toBe('/settings/study')
  })

  it('asks in focus mode: a way back, the count, the word on its card, the answers and “I don’t know”', async () => {
    await withBands()
    expect(screen.getByRole('link', { name: 'Back to settings' }).getAttribute('href')).toBe('/settings/study')
    expect(document.querySelector('.study-bar')?.textContent).toContain('0 words answered')
    // The word in the learner's language, and English words to choose from (owner's decision, 2026-10-14).
    expect(document.querySelector('.card .prompt-text')?.textContent).not.toBe('')
    expect(document.querySelector('.card .instruction')?.textContent).toBe('Choose the word in English')
    expect(document.querySelector('.study-actions .option-text')?.getAttribute('lang')).toBe('en')
    expect(document.querySelectorAll('.study-actions .option')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'I don’t know' }).classList.contains('dont-know')).toBe(true)
  })

  it('places a learner who knows every word at the highest band, and uses it once accepted', async () => {
    const { env, client, corpus } = await withBands()
    for (let i = 0; i < 40 && document.querySelector('.card .prompt-text'); i += 1) {
      env.advance(ITEM_SETTLE_MS + 1_000)
      const answer = rightAnswer(corpus)
      await act(async () => fireEvent.click(answer))
    }
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your level: B1')
    // The result is a card with the level as a badge, the choice below it.
    expect(document.querySelector('.done-card .level-badge')?.textContent).toBe('B1')
    expect([...document.querySelectorAll('.done-actions > *')].map((e) => e.textContent)).toEqual(['Use B1', 'Keep A1'])
    expect(client.snapshot.settings.declaredLevel).toBe('A1')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use B1' })))
    expect(client.snapshot.settings.declaredLevel).toBe('B1')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your level is now B1')
  })

  it('answers “I don’t know” with 0 on the keyboard, and places at A1', async () => {
    const { env } = await withBands()
    for (let i = 0; i < 40 && document.querySelector('.card .prompt-text'); i += 1) {
      env.advance(ITEM_SETTLE_MS + 1_000)
      await act(async () => fireEvent.keyDown(document.body, { key: '0' }))
    }
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your level: A1')
  })

  it('ignores a held key', async () => {
    const { env } = await withBands()
    env.advance(ITEM_SETTLE_MS + 1_000)
    await act(async () => fireEvent.keyDown(document.body, { key: '0', repeat: true }))
    expect(screen.getByText('0 words answered')).toBeTruthy()
  })

  it('moves focus to each new question', async () => {
    const { env } = await withBands()
    env.advance(ITEM_SETTLE_MS + 1_000)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'I don’t know' })))
    expect(document.activeElement?.classList.contains('card')).toBe(true)
  })

  it('moves focus to the result heading after the last answer', async () => {
    const { env } = await withBands()
    for (let i = 0; i < 40 && document.querySelector('.card .prompt-text'); i += 1) {
      env.advance(ITEM_SETTLE_MS + 1_000)
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'I don’t know' })))
    }
    const heading = screen.getByRole('heading', { level: 1, name: /^Your level: / })
    expect(document.activeElement).toBe(heading)
  })
})
