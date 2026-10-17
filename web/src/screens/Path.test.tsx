import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { corpusWordId, DAY_MS, entryClips, Grade, type WordId } from '@wordado/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerNew, fakeAudio, renderWith, setup, setupTrial, withProviders } from '../test/fixtures'
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

  it('makes the current unit’s marker a way into the session while there is one, for a pointer only', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    const marker = (title: string) => unit(title).querySelector('.unit-track .unit-marker')!
    expect(marker('People and greetings').tagName).toBe('A')
    expect(marker('People and greetings').getAttribute('href')).toBe('/study')
    // The same place as Start studying beside it: not a second stop for the keyboard or a screen reader.
    expect(marker('People and greetings').getAttribute('tabindex')).toBe('-1')
    expect(marker('People and greetings').closest('[aria-hidden="true"]')).not.toBeNull()
    expect(marker('Food and drink').tagName).toBe('SPAN')
    await act(() => answerNew(ctx.client, ctx.env, 10))
    // Nothing left today: a mark again, as Start studying is gone.
    expect(screen.queryByRole('link', { name: 'Start studying' })).toBeNull()
    expect(marker('People and greetings').tagName).toBe('SPAN')
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

  it('offers to practise a unit before any of its words is started, below Start studying on the current unit', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    const [first] = ctx.client.snapshot.corpus!.units
    const links = within(unit('People and greetings')).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['Start studying', 'Practise this unit'])
    // Named with its unit, so several on one page differ.
    expect(links[1]!.getAttribute('aria-label')).toBe('Practise this unit: People and greetings')
    expect(links[1]!.getAttribute('href')).toBe(`/practice?unit=${first!.unitId}`)
    expect(links[1]!.classList.contains('primary')).toBe(false)
    await act(() => answerNew(ctx.client, ctx.env, 5))
    expect(within(unit('People and greetings')).getAllByRole('link').map((a) => a.textContent)).toEqual(['Start studying', 'Practise this unit'])
  })

  it('offers practice on every unit, the locked ones included', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 30 })
    await answerNew(ctx.client, ctx.env, 25)
    renderWith(<Path />, ctx)
    expect(within(unit('Home and every day')).getByText('Locked')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /^Practise this unit/ }).map((a) => a.getAttribute('aria-label'))).toEqual([
      'Practise this unit: People and greetings',
      'Practise this unit: Food and drink',
      'Practise this unit: Home and every day',
    ])
    const third = ctx.client.snapshot.corpus!.units[2]!
    expect(within(unit('Home and every day')).getByRole('link', { name: /^Practise this unit/ }).getAttribute('href')).toBe(`/practice?unit=${third.unitId}`)
  })

  it('does not offer practice on a unit whose live words are all set aside, as practice leaves them out', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 1)
    const [first] = ctx.client.snapshot.corpus!.units
    renderWith(<Path />, ctx)
    // One set-aside word is not enough: the unit has others.
    await act(() => ctx.client.setFlag([...ctx.client.snapshot.states.keys()][0]!, 'known'))
    expect(screen.getByRole('link', { name: 'Practise this unit: People and greetings' })).toBeTruthy()
    for (const wordId of first!.wordIds) await act(() => ctx.client.setFlag(wordId, 'known'))
    expect(screen.queryByRole('link', { name: 'Practise this unit: People and greetings' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Practise this unit: Food and drink' })).toBeTruthy()
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

  it('leaves off a unit with no word the course teaches, all known from the start or retired, and keeps one the learner set aside (issue #288)', async () => {
    const ctx = await setup()
    const snapshot = ctx.client.snapshot
    const corpus = snapshot.corpus!
    const second = corpus.units[1]!
    const quiet = (notTaught: readonly WordId[], retired: readonly WordId[]) => {
      cleanup()
      ctx.client.store.set({ ...snapshot, corpus: { ...corpus, notTaught: new Set(notTaught), retired: new Set(retired) } })
      renderWith(<Path />, ctx)
    }
    quiet(second.wordIds, [])
    expect(screen.queryByRole('heading', { name: 'Food and drink' })).toBeNull()
    expect(screen.queryByText(/of 0 started/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'People and greetings' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Home and every day' })).toBeTruthy()
    quiet([], second.wordIds)
    expect(screen.queryByRole('heading', { name: 'Food and drink' })).toBeNull()
    quiet(second.wordIds.slice(0, 5), second.wordIds.slice(5))
    expect(screen.queryByRole('heading', { name: 'Food and drink' })).toBeNull()
    // One word still taught keeps the unit.
    quiet(second.wordIds.slice(1), [])
    expect(screen.getByRole('heading', { name: 'Food and drink' })).toBeTruthy()
    // Every word set aside by the learner: still the course's to teach, and still listed.
    cleanup()
    ctx.client.store.set({ ...snapshot, flags: new Map(second.wordIds.map((id) => [id, 'known' as const])) })
    renderWith(<Path />, ctx)
    expect(screen.getByRole('heading', { name: 'Food and drink' })).toBeTruthy()
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

  it('shows each word’s translation in a unit’s list, and a label only for a word’s own standing (spec §7.4)', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    const food = unit('Food and drink')
    fireEvent.click(within(food).getByText('20 words'))
    const bread = within(food).getByText('bread').closest('li')!
    const entry = ctx.client.entry('c:bread-1')!
    const translation = bread.querySelector('.translation')!
    expect(translation.textContent).toBe(entry.sense === '' ? entry.translations[0] : `${entry.translations[0]} (${entry.sense})`)
    expect(translation.getAttribute('lang')).toBe('bg')
    // Never started: the unit says so for all its words, the row does not repeat it.
    expect(bread.querySelector('.word-status')).toBeNull()
    expect(within(food).queryByText('Not started')).toBeNull()
    // Nor in a skipped level.
    await act(() => ctx.client.updateSettings({ declaredLevel: 'A2' }))
    expect(bread.querySelector('.word-status')).toBeNull()
    // Started, set aside or marked, the word has a standing of its own, and the row shows it.
    await act(() => ctx.client.answer({ wordId: 'c:bread-1', mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false }))
    expect(bread.querySelector('.word-status')!.textContent).toBe('Learning')
    await act(() => ctx.client.setFlag('c:cheese-1', 'known'))
    expect(within(food).getByText('cheese').closest('li')!.querySelector('.word-status')!.textContent).toBe('Known')
  })

  it('shows a standing as a mark that is named in words, and says it in words at the top of the word’s menu (spec §7.4)', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    const food = unit('Food and drink')
    fireEvent.click(within(food).getByText('20 words'))
    const row = (headword: string) => within(food).getByText(headword).closest('li')!
    await act(() => ctx.client.answer({ wordId: 'c:bread-1', mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false }))
    await act(() => ctx.client.setFlag('c:cheese-1', 'suspended'))
    for (const [headword, kind, words] of [['bread', 'learning', 'Learning'], ['cheese', 'suspended', 'Not now']] as const) {
      const mark = row(headword).querySelector('.word-status')!
      expect(mark.getAttribute('data-status')).toBe(kind)
      // A shape, hidden from a screen reader, and the standing in words for it: never colour alone.
      expect(mark.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
      expect(mark.querySelector('.visually-hidden')!.textContent).toBe(words)
      wordMenu(row(headword), headword)
      expect(row(headword).querySelector('.menu-standing')!.textContent).toBe(words)
      fireEvent.keyDown(row(headword).querySelector('.word-menu')!, { key: 'Escape' })
    }
    // A word that was never started has neither.
    wordMenu(row('milk'), 'milk')
    expect(row('milk').querySelector('.word-status')).toBeNull()
    expect(row('milk').querySelector('.menu-standing')).toBeNull()
  })

  it('reports a problem with a word from its menu, last in it, whatever the word’s standing (spec §8.10)', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    const food = unit('Food and drink')
    fireEvent.click(within(food).getByText('20 words'))
    const row = (headword: string) => within(food).getByText(headword).closest('li')!
    // A word set aside keeps the way to report it.
    await act(() => ctx.client.setFlag('c:cheese-1', 'known'))
    for (const headword of ['milk', 'cheese']) {
      wordMenu(row(headword), headword)
      const choices = within(row(headword).querySelector('.menu-panel') as HTMLElement).getAllByRole('button')
      expect(choices.at(-1)!.getAttribute('aria-label')).toBe(`Report this word: ${headword}`)
      expect(choices.at(-1)!.textContent).toBe('Report this word')
      fireEvent.keyDown(row(headword).querySelector('.word-menu')!, { key: 'Escape' })
    }
    wordMenu(row('milk'), 'milk')
    await act(async () => fireEvent.click(within(row('milk')).getByRole('button', { name: 'Report this word: milk' })))
    // The menu is closed, and the dialog names the word.
    expect(row('milk').querySelector('.menu-panel')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Report a problem with “milk”' })).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })))
    expect(screen.queryByRole('heading', { name: 'Report a problem with “milk”' })).toBeNull()
  })

  it('offers to play each word of a unit’s list, by name, when its clip can play; not otherwise (spec §11.1)', async () => {
    const ctx = await setup()
    const audio = fakeAudio({ streamable: () => true })
    const { unmount } = renderWith(<Path />, { ...ctx, audio })
    const food = unit('Food and drink')
    fireEvent.click(within(food).getByText('20 words'))
    const bread = within(food).getByText('bread').closest('li')!
    // First in the row, before the word and its menu.
    expect(within(bread).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Play the word: bread', 'Word actions: bread'])
    await act(async () => fireEvent.click(within(bread).getByRole('button', { name: 'Play the word: bread' })))
    expect(audio.played.map((clip) => clip.clipId)).toEqual([entryClips(ctx.client.snapshot.corpus!, ctx.client.entry('c:bread-1')!)[0]!.clipId])
    unmount()
    // Sound off: no button.
    await act(() => ctx.client.updateSettings({ audio: false }))
    renderWith(<Path />, { ...ctx, audio })
    fireEvent.click(within(unit('Food and drink')).getByText('20 words'))
    expect(screen.queryByRole('button', { name: /^Play the word/ })).toBeNull()
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
    expect(within(bread).getByText('To learn').closest('.word-status')!.getAttribute('data-status')).toBe('to-learn')
    expect(row('cheese').querySelector('.word-status')).toBeNull()
    expect(within(food).getAllByText('To learn')).toHaveLength(1)
    // Started by the session, it is a word like any other; the level stays skipped.
    await act(() => ctx.client.answer({ wordId: 'c:bread-1', mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false }))
    expect(within(bread).queryByText('To learn')).toBeNull()
    expect(within(bread).getByText('Learning')).toBeTruthy()
    expect(within(food).getByText('1 of 20 started')).toBeTruthy()
    expect(screen.getByText('Skipped: you placed above this level.')).toBeTruthy()
    // Set aside instead, a chosen word reads as set aside, and its mark is gone.
    await act(() => ctx.client.setToLearn('c:cheese-1', true))
    expect(within(row('cheese')).getByText('To learn')).toBeTruthy()
    await act(() => ctx.client.setFlag('c:cheese-1', 'suspended'))
    expect(within(row('cheese')).queryByText('To learn')).toBeNull()
    await act(() => ctx.client.setFlag('c:cheese-1', null))
    expect(row('cheese').querySelector('.word-status')).toBeNull()
  })

  it('marks a word to learn from a skipped unit’s word list, and takes the mark back there (spec §7.4)', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    renderWith(<Path />, ctx)
    const food = unit('Food and drink')
    fireEvent.click(within(food).getByText('20 words'))
    const bread = within(food).getByText('bread').closest('li')!
    wordMenu(bread, 'bread')
    expect(within(bread).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Word actions: bread', 'Learn this word: bread', 'I know it: bread', 'Not now: bread', 'Report this word: bread'])
    await act(async () => fireEvent.click(within(bread).getByRole('button', { name: 'Learn this word: bread' })))
    expect(ctx.client.snapshot.toLearn).toEqual(['c:bread-1'])
    expect(within(bread).getByText('To learn')).toBeTruthy()
    // The choice closes the menu, and focus is back on its button.
    expect(within(bread).queryByRole('button', { name: /^Learn this word/ })).toBeNull()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Word actions: bread')
    wordMenu(bread, 'bread')
    expect(within(bread).getAllByRole('button').map((b) => b.textContent)).toEqual(['', 'Don’t learn this word', 'I know it', 'Not now', 'Report this word'])
    await act(async () => fireEvent.click(within(bread).getByRole('button', { name: 'Don’t learn this word: bread' })))
    expect(ctx.client.snapshot.toLearn).toEqual([])
    expect(bread.querySelector('.word-status')).toBeNull()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Word actions: bread')
    // Set aside, a marked word loses its mark, and brought back it is an ordinary unstarted word again.
    await act(() => ctx.client.setToLearn('c:bread-1', true))
    wordMenu(bread, 'bread')
    await act(async () => fireEvent.click(within(bread).getByRole('button', { name: 'Not now: bread' })))
    expect(ctx.client.snapshot.toLearn).toEqual([])
    wordMenu(bread, 'bread')
    expect(within(bread).getAllByRole('button').map((b) => b.textContent)).toEqual(['', 'Bring back', 'Report this word'])
  })

  it('does not offer Learn this word in the word list of a level being studied, but lets a mark made earlier be taken back', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    await ctx.client.setToLearn('c:hello-1', true)
    await ctx.client.updateSettings({ declaredLevel: 'A1' })
    renderWith(<Path />, ctx)
    const people = unit('People and greetings')
    fireEvent.click(within(people).getByText('20 words'))
    const goodbye = within(people).getByText('goodbye').closest('li')!
    wordMenu(goodbye, 'goodbye')
    expect(within(goodbye).queryByRole('button', { name: /^Learn this word/ })).toBeNull()
    const hello = within(people).getByText('hello').closest('li')!
    expect(within(hello).getByText('To learn')).toBeTruthy()
    wordMenu(hello, 'hello')
    await act(async () => fireEvent.click(within(hello).getByRole('button', { name: 'Don’t learn this word: hello' })))
    expect(ctx.client.snapshot.toLearn).toEqual([])
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
    expect(first.querySelector('.word-status')).toBeNull()
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
    expect(first.querySelector('.word-status')).toBeNull()
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

describe('Path, opened at a unit', () => {
  const unitId = (ctx: Awaited<ReturnType<typeof setup>>, title: string) => ctx.client.snapshot.corpus!.units.find((u) => u.title.en === title)!.unitId

  it('opens the unit’s word list and marks its heading as where focus goes', async () => {
    const ctx = await setup()
    const id = unitId(ctx, 'Food and drink')
    renderWith(<Path unit={id} />, ctx)
    const item = unit('Food and drink')
    expect(item.id).toBe(`unit-${id}`)
    expect(item.querySelector('details')!.open).toBe(true)
    expect(within(item).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(within(item).getByRole('heading', { name: 'Food and drink' }).hasAttribute('data-route-focus')).toBe(true)
    // The unit is still locked: arriving at it unlocks nothing.
    expect(within(item).getByText('Locked')).toBeTruthy()
  })

  it('lets the learner fold the unit again: it opens once, on arrival', async () => {
    const ctx = await setup()
    renderWith(<Path unit={unitId(ctx, 'Food and drink')} />, ctx)
    const details = unit('Food and drink').querySelector('details')!
    details.open = false
    fireEvent(details, new Event('toggle'))
    expect(unit('Food and drink').querySelector('details')!.open).toBe(false)
  })

  it('opens and scrolls again when it is opened at the same unit a second time', async () => {
    const ctx = await setup()
    const id = unitId(ctx, 'Food and drink')
    const scrolled = vi.fn()
    const before = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrolled
    try {
      const { rerender } = renderWith(<Path unit={id} />, ctx)
      expect(scrolled).toHaveBeenCalledTimes(1)
      const details = unit('Food and drink').querySelector('details')!
      details.open = false
      fireEvent(details, new Event('toggle'))
      // The address went to the plain path and back while the screen stayed.
      rerender(withProviders(<Path />, ctx))
      expect(unit('Food and drink').querySelector('details')!.open).toBe(false)
      rerender(withProviders(<Path unit={id} />, ctx))
      expect(unit('Food and drink').querySelector('details')!.open).toBe(true)
      expect(scrolled).toHaveBeenCalledTimes(2)
    } finally {
      Element.prototype.scrollIntoView = before
    }
  })

  it('opens as usual for an ID no unit has', async () => {
    const ctx = await setup()
    renderWith(<Path unit="no-such-unit" />, ctx)
    expect(document.querySelector('details[open]')).toBeNull()
    expect(document.querySelector('[data-route-focus]')).toBeNull()
    expect(within(unit('People and greetings')).getByText('Current')).toBeTruthy()
  })

  describe('on a path with a second level and a unit beyond the next few', () => {
    // A1: one finished unit, the current one, then five more; A2: one locked unit. The sample's three units are the first three.
    const tall = async () => {
      const ctx = await setup()
      const snapshot = ctx.client.snapshot
      const corpus = snapshot.corpus!
      const [first, second] = corpus.units
      // Each with a word the sample does not hold: a unit with no word at all would be left off the path.
      const more = (id: string, level: 'A1' | 'A2', order: number) => ({ unitId: id, level, order, title: { en: `Extra ${id}`, l1: `Extra ${id}` }, wordIds: [corpusWordId(`extra-${id}-1`)] })
      const units = [...corpus.units, more('x4', 'A1', 4), more('x5', 'A1', 5), more('x6', 'A1', 6), more('b1', 'A2', 7)]
      const progress = { ...snapshot.progress!, units: new Map(snapshot.progress!.units).set(first!.unitId, { ...snapshot.progress!.units.get(first!.unitId)!, complete: true }) }
      const path = { unlocked: new Set([first!.unitId, second!.unitId]), currentUnitId: second!.unitId, trialFinished: false }
      ctx.client.store.set({ ...snapshot, corpus: { ...corpus, units }, progress, path })
      return { ctx, first: first!.unitId, third: corpus.units[2]!.unitId }
    }

    it('opens another level when the unit is in it', async () => {
      const { ctx } = await tall()
      renderWith(<Path />, ctx)
      expect(screen.getByRole('button', { name: /A2/ }).getAttribute('aria-expanded')).toBe('false')
      cleanup()
      renderWith(<Path unit="b1" />, ctx)
      expect(screen.getByRole('button', { name: /A2/ }).getAttribute('aria-expanded')).toBe('true')
      expect(screen.getByRole('heading', { name: 'Extra b1' }).hasAttribute('data-route-focus')).toBe(true)
    })

    it('shows every unit of the level being studied when the unit lies beyond the next few', async () => {
      const { ctx } = await tall()
      renderWith(<Path />, ctx)
      expect(screen.queryByRole('heading', { name: 'Extra x6' })).toBeNull()
      cleanup()
      renderWith(<Path unit="x6" />, ctx)
      for (const id of ['x4', 'x5', 'x6']) expect(screen.getByRole('heading', { name: `Extra ${id}` })).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Extra x6' }).hasAttribute('data-route-focus')).toBe(true)
    })

    it('counts in Show all only the units it lists, leaving off one with no word taught (issue #288)', async () => {
      const { ctx } = await tall()
      const snapshot = ctx.client.snapshot
      ctx.client.store.set({ ...snapshot, corpus: { ...snapshot.corpus!, notTaught: new Set([corpusWordId('extra-x4-1')]) } })
      renderWith(<Path />, ctx)
      fireEvent.click(screen.getByRole('button', { name: 'Show all 5 units' }))
      expect(screen.queryByRole('heading', { name: 'Extra x4' })).toBeNull()
      for (const id of ['x5', 'x6']) expect(screen.getByRole('heading', { name: `Extra ${id}` })).toBeTruthy()
    })

    it('opens the finished units when the unit is one of them', async () => {
      const { ctx, first } = await tall()
      renderWith(<Path />, ctx)
      expect(document.getElementById(`unit-${first}`)).toBeNull()
      cleanup()
      renderWith(<Path unit={first} />, ctx)
      expect(document.getElementById(`unit-${first}`)).toBeTruthy()
      expect(document.getElementById(`unit-${first}`)!.querySelector('details')!.open).toBe(true)
    })
  })

  it('gives every unit an ID and marks none without a unit to open at', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    expect(unit('People and greetings').id).toBe(`unit-${unitId(ctx, 'People and greetings')}`)
    expect(document.querySelector('[data-route-focus]')).toBeNull()
  })

  describe('in a trial', () => {
    it('lists the declared level’s one unit, with a note on the trial and the whole course', async () => {
      const ctx = await setupTrial({ declared: 'B1' })
      renderWith(<Path />, ctx)
      const units = ctx.client.snapshot.corpus!.units
      expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([expect.stringContaining('B1')])
      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1)
      expect(unit(units[2]!.title.en!)).toBeTruthy()
      const note = screen.getByText(/This is the demo: one unit of B1\./)
      expect(note.textContent).toContain('The whole course has 12 units at B1.')
      expect(within(note).getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/signin')
    })

    it('says only that it is the trial when the course has no size for the level', async () => {
      const ctx = await setupTrial({ declared: 'A2' })
      renderWith(<Path />, ctx)
      const note = screen.getByText(/This is the demo: one unit of A2\./)
      expect(note.textContent).not.toContain('whole course has')
      expect(within(note).getByRole('link', { name: 'Create an account' })).toBeTruthy()
    })

    it('adds no note to a course', async () => {
      renderWith(<Path />, await setup())
      expect(screen.queryByText(/This is the demo/)).toBeNull()
    })
  })
})
