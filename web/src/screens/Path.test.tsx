import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { DAY_MS, Grade } from '@wordado/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { translate, type Locale } from '../i18n/i18n'
import { LEVEL_STATUS, Path } from './Path'

afterEach(cleanup)

const unit = (title: string) => screen.getByRole('heading', { name: title }).closest('li')!

/** Opens a word's ⋯ menu, where setting it aside and bringing it back live. */
const wordMenu = (row: HTMLElement, headword: string) => fireEvent.click(within(row).getByRole('button', { name: `Word actions: ${headword}` }))

describe('Path', () => {
  it('shows the first unit current and the rest locked before any answer', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    expect(within(unit('People and greetings')).getByText('Current')).toBeTruthy()
    expect(within(unit('People and greetings')).getByText('0 of 20 started')).toBeTruthy()
    expect(within(unit('Food and drink')).getByText('Locked')).toBeTruthy()
    expect(screen.getByText('0 of 60 words learned well')).toBeTruthy()
  })

  it('shows the level as a bar, and offers to study from the current unit', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    const level = screen.getByRole('progressbar', { name: 'A1: 0 of 60 words learned well' })
    expect(level.getAttribute('aria-valuemax')).toBe('60')
    expect(within(unit('People and greetings')).getByRole('link', { name: 'Start studying' }).getAttribute('href')).toBe('/study')
    expect(within(unit('Food and drink')).queryByRole('link', { name: 'Start studying' })).toBeNull()
  })

  it('offers Start studying only while today’s session has something in it, as Today does', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    const current = unit('People and greetings')
    expect(within(current).getByRole('link', { name: 'Start studying' })).toBeTruthy()
    expect(within(current).queryByText('Nothing left for today.')).toBeNull()
    // The day's ten new words are taken and nothing is due: the session would end at once.
    await act(() => answerNew(ctx.client, ctx.env, 10))
    expect(screen.queryByRole('link', { name: 'Start studying' })).toBeNull()
    expect(within(current).getByText('Nothing left for today.')).toBeTruthy()
    expect(within(current).getByRole('link', { name: 'Practise this unit: People and greetings' })).toBeTruthy()
  })

  it('says nothing about today until the plan is known: neither Start studying nor that the day is done', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    ctx.client.store.set({ ...ctx.client.snapshot, plan: null })
    renderWith(<Path />, ctx)
    const current = unit('People and greetings')
    expect(within(current).getByText('Current')).toBeTruthy()
    expect(within(current).queryByRole('link', { name: 'Start studying' })).toBeNull()
    expect(within(current).queryByText('Nothing left for today.')).toBeNull()
    // Practice does not wait for the plan.
    expect(within(current).getByRole('link', { name: 'Practise this unit: People and greetings' })).toBeTruthy()
  })

  it('offers to practise a unit once one of its words is started, below Start studying on the current unit', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    expect(screen.queryByRole('link', { name: /^Practise this unit/ })).toBeNull()
    await act(() => answerNew(ctx.client, ctx.env, 5))
    const [first] = ctx.client.snapshot.corpus!.units
    const links = within(unit('People and greetings')).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['Start studying', 'Practise this unit'])
    // Named with its unit, so several on one page differ.
    expect(links[1]!.getAttribute('aria-label')).toBe('Practise this unit: People and greetings')
    expect(links[1]!.getAttribute('href')).toBe(`/practice?unit=${first!.unitId}`)
    expect(links[1]!.classList.contains('primary')).toBe(false)
    expect(screen.getAllByRole('link', { name: /^Practise this unit/ })).toHaveLength(1)
  })

  it('offers practice on every open unit with started words, and never on a locked one', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 30 })
    await answerNew(ctx.client, ctx.env, 25)
    // A word of the locked third unit, started some other way (a theme pulls words forward, spec §8.9).
    const third = ctx.client.snapshot.corpus!.units[2]!
    await ctx.client.answer({ wordId: third.wordIds[0]!, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    renderWith(<Path />, ctx)
    expect(within(unit('Home and every day')).getByText('Locked')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /^Practise this unit/ }).map((a) => a.getAttribute('aria-label'))).toEqual([
      'Practise this unit: People and greetings',
      'Practise this unit: Food and drink',
    ])
  })

  it('does not offer practice on a unit whose only started words are set aside, as practice leaves them out', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 1)
    const started = [...ctx.client.snapshot.states.keys()][0]!
    renderWith(<Path />, ctx)
    expect(screen.getByRole('link', { name: 'Practise this unit: People and greetings' })).toBeTruthy()
    await act(() => ctx.client.setFlag(started, 'known'))
    expect(screen.queryByRole('link', { name: /^Practise this unit/ })).toBeNull()
  })

  it('moves the current unit on once every word of the first is introduced', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 30 })
    renderWith(<Path />, ctx)
    await act(() => answerNew(ctx.client, ctx.env, 20))
    // Introduced is not complete: the unit is still being learned, so it stays in view.
    expect(within(unit('People and greetings')).getByText('20 of 20 started')).toBeTruthy()
    expect(within(unit('Food and drink')).getByText('Current')).toBeTruthy()
    expect(within(unit('Home and every day')).getByText('Locked')).toBeTruthy()
  })

  it('folds the finished units into one line that opens them', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 30 })
    await answerNew(ctx.client, ctx.env, 20)
    // A unit is complete once its words pass a review on a later day (spec §7.2).
    ctx.env.advance(2 * DAY_MS)
    await ctx.client.updateSettings({ reviewCap: 50 })
    for (const wordId of ctx.client.snapshot.plan!.reviews) {
      await ctx.client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
      ctx.env.advance(3_000)
    }
    renderWith(<Path />, ctx)
    expect(screen.queryByRole('heading', { name: 'People and greetings' })).toBeNull()
    const fold = screen.getByRole('button', { name: '1 unit complete' })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(fold)
    expect(within(unit('People and greetings')).getByText('Complete')).toBeTruthy()
  })

  it('opens the level being studied and lets it fold', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    const header = screen.getByRole('button', { name: /^A1/ })
    expect(header.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('heading', { name: 'People and greetings' })).toBeNull()
    // Folded, the level still says where it stands.
    expect(within(header).getByText('0 of 60 words learned well')).toBeTruthy()
    fireEvent.click(header)
    expect(screen.getByRole('heading', { name: 'People and greetings' })).toBeTruthy()
  })

  it('shows a level below the declared one as skipped, never as complete (spec §7.2)', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    renderWith(<Path />, ctx)
    expect(screen.getByText('Skipped: you placed above this level.')).toBeTruthy()
    // A1 is unlocked outright once A2 is declared, but is neither current nor complete/mastered.
    expect(within(unit('People and greetings')).getByText('Open')).toBeTruthy()
  })

  it('offers to practise every unit of a skipped level, though none of its words is started, and never Start studying (spec §7.2)', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    renderWith(<Path />, ctx)
    const units = ctx.client.snapshot.corpus!.units
    expect(ctx.client.snapshot.states.size).toBe(0)
    expect(screen.getAllByRole('link', { name: /^Practise this unit/ }).map((a) => [a.textContent, a.getAttribute('aria-label'), a.getAttribute('href')])).toEqual([
      ['Practise this unit', 'Practise this unit: People and greetings', `/practice?unit=${units[0]!.unitId}`],
      ['Practise this unit', 'Practise this unit: Food and drink', `/practice?unit=${units[1]!.unitId}`],
      ['Practise this unit', 'Practise this unit: Home and every day', `/practice?unit=${units[2]!.unitId}`],
    ])
    expect(screen.queryByRole('link', { name: 'Start studying' })).toBeNull()
    expect(screen.queryByText('Nothing left for today.')).toBeNull()
    // The units are drawn as before: open, with their count and their words.
    const food = unit('Food and drink')
    expect(within(food).getByText('Open')).toBeTruthy()
    expect(within(food).getByText('0 of 20 started')).toBeTruthy()
    expect(within(food).getByText('20 words')).toBeTruthy()
  })

  it('does not offer practice on a skipped level’s unit whose words are all set aside', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    for (const wordId of ctx.client.snapshot.corpus!.units[1]!.wordIds) await ctx.client.setFlag(wordId, 'known')
    renderWith(<Path />, ctx)
    expect(screen.getAllByRole('link', { name: /^Practise this unit/ }).map((a) => a.getAttribute('aria-label'))).toEqual([
      'Practise this unit: People and greetings',
      'Practise this unit: Home and every day',
    ])
  })

  it('labels a word chosen with Learn this word in a skipped level’s unit, until it is started (spec §7.4)', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    await ctx.client.setToLearn('c:bread-1', true)
    renderWith(<Path />, ctx)
    const food = unit('Food and drink')
    fireEvent.click(within(food).getByText('20 words'))
    const row = (headword: string) => within(food).getByText(headword).closest('li')!
    const bread = row('bread')
    expect(within(bread).getByText('To learn').getAttribute('data-status')).toBe('to-learn')
    expect(within(row('cheese')).getByText('Not started')).toBeTruthy()
    expect(within(food).getAllByText('To learn')).toHaveLength(1)
    // Started by the session, it is a word like any other; the level stays skipped.
    await act(() => ctx.client.answer({ wordId: 'c:bread-1', mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false }))
    expect(within(bread).queryByText('To learn')).toBeNull()
    expect(within(bread).getByText('Learning')).toBeTruthy()
    expect(within(food).getByText('1 of 20 started')).toBeTruthy()
    expect(screen.getByText('Skipped: you placed above this level.')).toBeTruthy()
    // Set aside instead, a chosen word reads as set aside.
    await act(() => ctx.client.setToLearn('c:cheese-1', true))
    expect(within(row('cheese')).getByText('To learn')).toBeTruthy()
    await act(() => ctx.client.setFlag('c:cheese-1', 'suspended'))
    expect(within(row('cheese')).queryByText('To learn')).toBeNull()
  })

  it('names a folded level’s status in a form that agrees with “level”, not “unit” (plan 12, review)', async () => {
    const ctx = await setup()
    renderWith(<Path />, { ...ctx, locale: 'bg' })
    fireEvent.click(document.querySelector<HTMLButtonElement>('.level-toggle')!)
    expect(document.querySelector('.level-status')!.textContent).toBe('Отворено')
    cleanup()
    renderWith(<Path />, { ...ctx, locale: 'es' })
    expect(within(unit('Food and drink')).getByText('Sin desbloquear')).toBeTruthy()
    fireEvent.click(document.querySelector<HTMLButtonElement>('.level-toggle')!)
    expect(document.querySelector('.level-status')!.textContent).toBe('Disponible')
  })

  it('has level labels of its own: neuter in Bulgarian, masculine in Spanish (plan 12, review)', () => {
    const label = (locale: Locale, status: keyof typeof LEVEL_STATUS) => translate(locale, LEVEL_STATUS[status])
    expect(['bg', 'de', 'en', 'es'].map((l) => label(l as Locale, 'complete'))).toEqual(['Завършено', 'Abgeschlossen', 'Complete', 'Completado'])
    expect(['bg', 'de', 'en', 'es'].map((l) => label(l as Locale, 'locked'))).toEqual(['Заключено', 'Gesperrt', 'Locked', 'Sin desbloquear'])
    expect(['bg', 'de', 'en', 'es'].map((l) => label(l as Locale, 'open'))).toEqual(['Отворено', 'Offen', 'Open', 'Disponible'])
    expect(translate('es', 'path.complete')).toBe('Completada')
    expect(translate('bg', 'path.complete')).toBe('Завършен')
  })

  it('uses the pack’s own unit titles in Bulgarian', async () => {
    const ctx = await setup()
    renderWith(<Path />, { ...ctx, locale: 'bg' })
    expect(screen.getByRole('heading', { name: 'Хора и поздрави' })).toBeTruthy()
  })

  it('lists a unit’s words only once opened, and sets one aside before it is ever taught (spec §7.4)', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    const food = unit('Food and drink')
    // Closed by default: a unit's word list is not rendered (and does not subscribe to the snapshot) until opened.
    expect(within(food).queryAllByRole('listitem')).toHaveLength(0)
    // happy-dom toggles a <details> open on a click of its <summary>, firing the native `toggle` event.
    await act(async () => fireEvent.click(food.querySelector('summary')!))
    const words = within(food).getAllByRole('listitem')
    expect(words).toHaveLength(20)
    const first = words[0]!
    const headword = first.querySelector('[lang="en"]')!.textContent!
    expect(within(first).getByText('Not started')).toBeTruthy()
    // The actions sit behind the word's ⋯ button, which takes focus back once a choice is made (spec §11.1).
    expect(within(first).queryByRole('button', { name: `I know it: ${headword}` })).toBeNull()
    wordMenu(first, headword)
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: `I know it: ${headword}` })))
    expect(within(first).getByText('Known')).toBeTruthy()
    expect(document.activeElement).toBe(within(first).getByRole('button', { name: `Word actions: ${headword}` }))
    expect([...ctx.client.snapshot.flags.values()]).toEqual(['known'])
    wordMenu(first, headword)
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: `Bring back: ${headword}` })))
    expect(ctx.client.snapshot.flags.size).toBe(0)
    expect(within(first).getByText('Not started')).toBeTruthy()
  })

  it('shows a saved-failed alert beside the word when setting it aside fails (spec §11.1)', async () => {
    const ctx = await setup()
    vi.spyOn(ctx.client, 'setFlag').mockRejectedValue(new Error('disk full'))
    renderWith(<Path />, ctx)
    const food = unit('Food and drink')
    await act(async () => fireEvent.click(food.querySelector('summary')!))
    const first = within(food).getAllByRole('listitem')[0]!
    const headword = first.querySelector('[lang="en"]')!.textContent!
    wordMenu(first, headword)
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: `I know it: ${headword}` })))
    expect(within(first).getByRole('alert').textContent).toBe('Your change wasn’t saved: Something went wrong. Try again.')
    expect(ctx.client.snapshot.flags.size).toBe(0)
  })
})
