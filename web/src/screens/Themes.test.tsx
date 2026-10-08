import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { corpusWordId, Grade, themeEntries } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { answerNew, renderWith, setup, withMoreThemes } from '../test/fixtures'
import { Themes } from './Themes'

afterEach(cleanup)

/** A group of themes: a region named by its heading. */
const group = (name: string) => screen.getByRole('region', { name })
const groups = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
const themesIn = (name: string) =>
  within(group(name))
    .queryAllByRole('heading', { level: 3 })
    .map((h) => h.textContent)
const card = (title: string) => screen.getByRole('heading', { level: 3, name: title }).closest('li')!
const status = () => screen.getByRole('status').textContent

describe('Themes', () => {
  it('lists only the themes big enough to offer, with their size', async () => {
    const ctx = await setup()
    renderWith(<Themes />, ctx)
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Daily life'])
    expect(screen.getByText('0 of 25 words started')).toBeTruthy()
  })

  it('shows how much of each theme is started, as a bar', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Themes />, ctx)
    const started = themeEntries(ctx.client.snapshot.corpus!, 'daily-life').filter((e) => ctx.client.snapshot.states.has(corpusWordId(e.entryId))).length
    const bar = screen.getByRole('progressbar', { name: `Daily life: ${started} of 25 words started` })
    expect(bar.getAttribute('aria-valuenow')).toBe(String(started))
    expect(bar.getAttribute('aria-valuemax')).toBe('25')
  })

  it('makes a theme’s words come first, and clears it again', async () => {
    const ctx = await setup()
    renderWith(<Themes />, ctx)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Study this next: Daily life' })))
    expect(ctx.client.snapshot.settings.activeTheme).toBe('daily-life')
    const theme = new Set(themeEntries(ctx.client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId)))
    expect(ctx.client.snapshot.plan!.newWords.every((w) => theme.has(w))).toBe(true)
    expect(within(card('Daily life')).getByText('Studying now')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Back to the path' })))
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
  })

  it('offers to practise a theme with nothing started, without choosing the theme, and not once every word is set aside', async () => {
    const ctx = await setup()
    renderWith(<Themes />, ctx)
    expect(ctx.client.snapshot.states.size).toBe(0)
    const link = screen.getByRole('link', { name: 'Practise this theme: Daily life' })
    expect(link.textContent).toBe('Practise this theme')
    expect(link.getAttribute('href')).toBe('/practice?theme=daily-life')
    // A link, not a choice: the study theme is the learner's to set with the button beside it.
    fireEvent.click(link)
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
    expect(screen.getByRole('button', { name: 'Study this next: Daily life' })).toBeTruthy()
    const words = themeEntries(ctx.client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId))
    for (const wordId of words.slice(1)) await act(() => ctx.client.setFlag(wordId, 'suspended'))
    // One word is left to practise.
    expect(screen.getByRole('link', { name: 'Practise this theme: Daily life' })).toBeTruthy()
    await act(() => ctx.client.setFlag(words[0]!, 'known'))
    expect(screen.queryByRole('link', { name: /^Practise this theme/ })).toBeNull()
    expect(card('Daily life').classList.contains('has-practise')).toBe(false)
    // Nothing was started by any of it: the theme is still not started, and can still be chosen.
    expect(themesIn('Not started')).toEqual(['Daily life'])
    expect(screen.getByRole('button', { name: 'Study this next: Daily life' })).toBeTruthy()
  })

  it('does not offer practice on a theme whose only word that is not set aside has been retired', async () => {
    const ctx = await setup()
    const [entry, ...rest] = themeEntries(ctx.client.snapshot.corpus!, 'daily-life')
    const wordId = corpusWordId(entry!.entryId)
    await ctx.client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    for (const other of rest) await ctx.client.setFlag(corpusWordId(other.entryId), 'known')
    renderWith(<Themes />, ctx)
    expect(screen.getByRole('link', { name: 'Practise this theme: Daily life' })).toBeTruthy()
    // A later pack retires the word (spec §5.1); its review state stays.
    const snapshot = ctx.client.snapshot
    const entries = new Map(snapshot.corpus!.entries).set(entry!.entryId, { ...entry!, retired: true })
    act(() => ctx.client.store.set({ ...snapshot, corpus: { ...snapshot.corpus!, entries, retired: new Set([wordId]) } }))
    expect(screen.queryByRole('link', { name: /^Practise this theme/ })).toBeNull()
  })

  it('offers practice on the theme being studied too', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ activeTheme: 'daily-life' })
    await answerNew(ctx.client, ctx.env, 3)
    renderWith(<Themes />, ctx)
    expect(within(card('Daily life')).getByText('Studying now')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Practise this theme: Daily life' }).getAttribute('href')).toBe('/practice?theme=daily-life')
    expect(ctx.client.snapshot.settings.activeTheme).toBe('daily-life')
  })

  it('names themes from the pack in Bulgarian', async () => {
    const ctx = await setup()
    renderWith(<Themes />, { ...ctx, locale: 'bg' })
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Всекидневие')
  })
})

describe('Themes: three groups', () => {
  it('says no theme is chosen, and leaves out a group with no themes', async () => {
    const ctx = await setup()
    withMoreThemes(ctx.client)
    renderWith(<Themes />, ctx)
    expect(groups()).toEqual(['Studying now', 'Not started'])
    expect(within(group('Studying now')).getByText('No theme chosen. New words follow your path.')).toBeTruthy()
    expect(themesIn('Studying now')).toEqual([])
    // The pack's order.
    expect(themesIn('Not started')).toEqual(['Daily life', 'First words', 'Later words'])
    expect(screen.queryByRole('region', { name: 'Studied' })).toBeNull()
  })

  it('sorts the themes by state: the chosen one, the ones with a started word, the rest', async () => {
    const ctx = await setup()
    withMoreThemes(ctx.client)
    await answerNew(ctx.client, ctx.env, 5)
    // Chosen with nothing started yet.
    await ctx.client.updateSettings({ activeTheme: 'later-words' })
    renderWith(<Themes />, ctx)
    expect(groups()).toEqual(['Studying now', 'Studied', 'Not started'])
    expect(themesIn('Studying now')).toEqual(['Later words'])
    expect(themesIn('Studied')).toEqual(['First words'])
    expect(themesIn('Not started')).toEqual(['Daily life'])

    const actions = (title: string) => [...card(title).querySelectorAll('a, button')].map((el) => [el.getAttribute('aria-label') ?? el.textContent, el.classList.contains('is-quiet')])

    // The chosen theme: the chip, practice though nothing of it is started, and the way back to the path.
    const now = within(group('Studying now'))
    expect(within(card('Later words')).getByText('Studying now')).toBeTruthy()
    expect(card('Later words').classList.contains('is-active')).toBe(true)
    expect(actions('Later words')).toEqual([
      ['Practise this theme: Later words', false],
      ['Back to the path', false],
    ])
    expect(now.queryByText('No theme chosen. New words follow your path.')).toBeNull()

    // A studied theme: practice first, then the quieter choice.
    const studied = within(card('First words'))
    expect(actions('First words')).toEqual([
      ['Practise this theme: First words', false],
      ['Study this next: First words', true],
    ])
    expect(studied.getByText('5 of 30 words started')).toBeTruthy()

    // A theme not started: choosing it first, then the quieter practice of the whole theme.
    expect(actions('Daily life')).toEqual([
      ['Study this next: Daily life', false],
      ['Practise this theme: Daily life', true],
    ])
    expect(card('Daily life').classList.contains('is-new')).toBe(true)
    expect(card('Daily life').classList.contains('has-practise')).toBe(true)
    expect(screen.getAllByRole('link', { name: /^Practise this theme/ }).map((a) => a.getAttribute('href'))).toEqual([
      '/practice?theme=later-words',
      '/practice?theme=first-words',
      '/practice?theme=daily-life',
    ])
    expect(within(card('Daily life')).getByText('0 of 25 words started')).toBeTruthy()
  })

  it('offers practice in every group, and leaves it out only where no word can be practised', async () => {
    const ctx = await setup()
    withMoreThemes(ctx.client)
    await answerNew(ctx.client, ctx.env, 5)
    await ctx.client.updateSettings({ activeTheme: 'later-words' })
    // Every word of one theme is set aside: the theme stays where the plan puts it, without practice.
    for (const e of themeEntries(ctx.client.snapshot.corpus!, 'daily-life')) await ctx.client.setFlag(corpusWordId(e.entryId), 'known')
    renderWith(<Themes />, ctx)
    expect(themesIn('Not started')).toEqual(['Daily life'])
    expect(screen.getAllByRole('link', { name: /^Practise this theme/ }).map((a) => a.getAttribute('aria-label'))).toEqual(['Practise this theme: Later words', 'Practise this theme: First words'])
    expect([...card('Daily life').querySelectorAll('a, button')].map((el) => el.getAttribute('aria-label'))).toEqual(['Study this next: Daily life'])
    // Practice starts nothing, so it moves no theme to another group.
    expect(groups()).toEqual(['Studying now', 'Studied', 'Not started'])
  })

  it('leaves out the not-started group once every theme is started or chosen', async () => {
    const ctx = await setup()
    withMoreThemes(ctx.client)
    await answerNew(ctx.client, ctx.env, 5)
    const dailyLife = corpusWordId(themeEntries(ctx.client.snapshot.corpus!, 'daily-life')[0]!.entryId)
    await ctx.client.answer({ wordId: dailyLife, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    await ctx.client.updateSettings({ activeTheme: 'later-words' })
    renderWith(<Themes />, ctx)
    expect(groups()).toEqual(['Studying now', 'Studied'])
    expect(themesIn('Studied')).toEqual(['Daily life', 'First words'])
  })

  it('moves a chosen theme to the top, says so, and drops the one before by its own state', async () => {
    const ctx = await setup()
    withMoreThemes(ctx.client)
    await answerNew(ctx.client, ctx.env, 5)
    await ctx.client.updateSettings({ activeTheme: 'later-words' })
    renderWith(<Themes />, ctx)
    expect(status()).toBe('')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Study this next: First words' })))
    expect(ctx.client.snapshot.settings.activeTheme).toBe('first-words')
    expect(themesIn('Studying now')).toEqual(['First words'])
    // Later words has no started word: it drops to the last group, in the pack's order.
    expect(themesIn('Not started')).toEqual(['Daily life', 'Later words'])
    expect(screen.queryByRole('region', { name: 'Studied' })).toBeNull()
    expect(status()).toBe('Now studying: First words')
    // The card jumped: focus goes with it.
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'First words' }))
    expect(within(group('Studying now')).getByRole('link', { name: 'Practise this theme: First words' })).toBeTruthy()

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Study this next: Daily life' })))
    expect(themesIn('Studying now')).toEqual(['Daily life'])
    expect(themesIn('Studied')).toEqual(['First words'])
    expect(status()).toBe('Now studying: Daily life')
  })

  it('clears the choice: the theme goes back to its group, and the line says the path leads again', async () => {
    const ctx = await setup()
    withMoreThemes(ctx.client)
    await answerNew(ctx.client, ctx.env, 5)
    await ctx.client.updateSettings({ activeTheme: 'first-words' })
    renderWith(<Themes />, ctx)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Back to the path' })))
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
    expect(themesIn('Studying now')).toEqual([])
    expect(themesIn('Studied')).toEqual(['First words'])
    expect(status()).toBe('No theme chosen. New words follow your path.')
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'First words' }))
  })

  it('heads the groups at level 2 and the themes at level 3, and names every action with its theme', async () => {
    const ctx = await setup()
    withMoreThemes(ctx.client)
    await answerNew(ctx.client, ctx.env, 5)
    await ctx.client.updateSettings({ activeTheme: 'first-words' })
    renderWith(<Themes />, ctx)
    expect(screen.getAllByRole('heading').map((h) => `${h.tagName} ${h.textContent}`)).toEqual([
      'H1 Themes',
      'H2 Studying now',
      'H3 First words',
      'H2 Not started',
      'H3 Daily life',
      'H3 Later words',
    ])
    const names = screen.getAllByRole('button', { name: /^Study this next/ }).map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(['Study this next: Daily life', 'Study this next: Later words'])
    expect(new Set(names).size).toBe(names.length)
  })

  it('speaks Bulgarian', async () => {
    const ctx = await setup()
    withMoreThemes(ctx.client)
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Themes />, { ...ctx, locale: 'bg' })
    expect(groups()).toEqual(['Учите сега', 'Започнати', 'Незапочнати'])
    expect(screen.getByText('Няма избрана тема. Новите думи следват вашия път.')).toBeTruthy()
  })
})
