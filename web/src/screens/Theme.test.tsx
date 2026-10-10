import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { corpusWordId, Grade, themeEntries } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { ThemeWords } from './Theme'

afterEach(cleanup)

const status = () => screen.getByRole('status').textContent
const level = (code: string) => screen.getByRole('button', { name: new RegExp(`^${code}`) })
const words = (within_: HTMLElement = document.body) => [...within_.querySelectorAll('.word-head')].map((el) => el.textContent)
const box = () => screen.getByRole<HTMLInputElement>('searchbox', { name: 'Find a word in this theme' })
const type = (query: string) => fireEvent.change(box(), { target: { value: query } })

/**
 * The sample's one offered theme, with its last five words moved up to B1. The client's own corpus is untouched, so
 * the levels last until the client next rebuilds its snapshot: `before` is for what must happen first.
 */
async function setupWithTwoLevels(before?: (ctx: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const ctx = await setup()
  await before?.(ctx)
  const snapshot = ctx.client.snapshot
  const upper = new Set(themeEntries(snapshot.corpus!, 'daily-life').slice(-5).map((e) => e.entryId))
  const entries = new Map([...snapshot.corpus!.entries].map(([id, e]) => [id, upper.has(id) ? { ...e, level: 'B1' as const } : e]))
  ctx.client.store.set({ ...snapshot, corpus: { ...snapshot.corpus!, entries } })
  return ctx
}

describe('ThemeWords', () => {
  it('shows the theme as its card does, and its words by level in the path’s order', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 3)
    renderWith(<ThemeWords themeId="daily-life" query="" />, ctx)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Daily life')
    expect(screen.getByText('Your day from morning to night.')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Daily life: 0 of 25 words started' }).getAttribute('aria-valuemax')).toBe('25')
    expect(screen.getByRole('link', { name: 'Back to themes' }).getAttribute('href')).toBe('/themes')
    expect(screen.getByRole('link', { name: 'Practise this theme' }).getAttribute('href')).toBe('/practice?theme=daily-life')
    expect(level('A1').getAttribute('aria-expanded')).toBe('true')
    expect(level('A1').textContent).toBe('A10 of 25 words started')
    expect(words()).toEqual(themeEntries(ctx.client.snapshot.corpus!, 'daily-life').map((e) => e.headword))
    expect(words().slice(0, 3)).toEqual(['breakfast', 'lunch', 'dinner'])
    const row = screen.getByText('time').closest('li')!
    expect(row.textContent).toContain('време (по часовник)')
  })

  it('opens the levels up to the learner’s own, folds the higher ones, and mounts no row of a folded level', async () => {
    const ctx = await setupWithTwoLevels()
    renderWith(<ThemeWords themeId="daily-life" query="" />, ctx)
    expect(screen.getByText('Includes words above your level')).toBeTruthy()
    expect(level('A1').getAttribute('aria-expanded')).toBe('true')
    expect(level('B1').getAttribute('aria-expanded')).toBe('false')
    expect(level('B1').textContent).toBe('B10 of 5 words started')
    expect(words()).toHaveLength(20)
    fireEvent.click(level('B1'))
    expect(words()).toHaveLength(25)
    expect(words(level('B1').closest('section')!)).toEqual(['week', 'work', 'school', 'shop', 'money'])
    fireEvent.click(level('A1'))
    expect(words()).toHaveLength(5)
  })

  it('opens the first level of a theme that starts above the learner’s level', async () => {
    const ctx = await setup()
    const snapshot = ctx.client.snapshot
    const entries = new Map([...snapshot.corpus!.entries].map(([id, e]) => [id, { ...e, level: 'B2' as const }]))
    ctx.client.store.set({ ...snapshot, corpus: { ...snapshot.corpus!, entries } })
    renderWith(<ThemeWords themeId="daily-life" query="" />, ctx)
    expect(level('B2').getAttribute('aria-expanded')).toBe('true')
    expect(words()).toHaveLength(25)
  })

  it('counts the started words, on the theme and on each level', async () => {
    const ctx = await setupWithTwoLevels(async ({ client }) => {
      for (const entry of themeEntries(client.snapshot.corpus!, 'daily-life').slice(0, 2)) {
        await client.answer({ wordId: corpusWordId(entry.entryId), mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
      }
    })
    renderWith(<ThemeWords themeId="daily-life" query="" />, ctx)
    expect(screen.getByRole('progressbar', { name: 'Daily life: 2 of 25 words started' })).toBeTruthy()
    expect(level('A1').textContent).toBe('A12 of 20 words started')
    expect(level('B1').textContent).toBe('B10 of 5 words started')
  })

  it('chooses the theme and gives it back, says so, and moves focus to the title', async () => {
    const ctx = await setup()
    renderWith(<ThemeWords themeId="daily-life" query="" />, ctx)
    expect(status()).toBe('')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Study this next' })))
    expect(ctx.client.snapshot.settings.activeTheme).toBe('daily-life')
    expect(screen.getByText('Studying now')).toBeTruthy()
    expect(status()).toBe('Now studying: Daily life')
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
    expect(screen.queryByRole('button', { name: 'Study this next' })).toBeNull()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Back to the path' })))
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
    expect(status()).toBe('No theme chosen. New words follow your path.')
    expect(screen.getByRole('button', { name: 'Study this next' })).toBeTruthy()
  })

  it('lets any word that is not started be marked to learn, and set aside, from its row', async () => {
    const ctx = await setup()
    renderWith(<ThemeWords themeId="daily-life" query="" />, ctx)
    // The theme's last word: far along the path, in a unit that is still locked.
    const entry = themeEntries(ctx.client.snapshot.corpus!, 'daily-life').at(-1)!
    const row = screen.getByText(entry.headword).closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: `Word actions: ${entry.headword}` }))
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: `Learn this word: ${entry.headword}` })))
    expect(ctx.client.snapshot.toLearn).toContain(corpusWordId(entry.entryId))
    expect(within(row).getByText('To learn')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: `Word actions: ${entry.headword}` }))
    expect(within(row).getByRole('button', { name: `I know it: ${entry.headword}` })).toBeTruthy()
  })

  it('finds words of the theme, in one list in place of the levels, and brings the levels back', async () => {
    const ctx = await setupWithTwoLevels()
    renderWith(<ThemeWords themeId="daily-life" query="" />, ctx)
    type('d')
    expect(screen.queryByRole('heading', { level: 2, name: /found/ })).toBeNull()
    type('мага')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('1 word found')
    // A word of a folded level is found all the same.
    expect(words()).toEqual(['shop'])
    expect(status()).toBe('1 word found')
    expect(screen.queryByRole('button', { name: /^A1/ })).toBeNull()
    type('do')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('1 word found')
    expect(words()).toEqual(['door'])
    type('zz')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('No word of this theme has “zz”.')
    fireEvent.click(screen.getByRole('button', { name: 'Show all words' }))
    expect(box().value).toBe('')
    expect(level('A1').getAttribute('aria-expanded')).toBe('true')
    type('ke')
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(words()).toHaveLength(20)
  })

  it('starts with the search a Themes result carried over', async () => {
    const ctx = await setup()
    renderWith(<ThemeWords themeId="daily-life" query="ключ" />, ctx)
    expect(box().value).toBe('ключ')
    expect(words()).toEqual(['key'])
  })

  it('shows the themes for an address that names no offered theme', async () => {
    const ctx = await setup()
    renderWith(<ThemeWords themeId="food" query="" />, ctx)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Themes')
    cleanup()
    renderWith(<ThemeWords themeId="nonsense" query="" />, ctx)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Themes')
  })

  it('reads in Bulgarian', async () => {
    const ctx = await setup()
    renderWith(<ThemeWords themeId="daily-life" query="клю" />, { ...ctx, locale: 'bg' })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Всекидневие')
    expect(screen.getByRole('searchbox', { name: 'Намерете дума в тази тема' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Намерена е 1 дума')
  })
})
