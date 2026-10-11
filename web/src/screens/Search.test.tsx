import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { corpusWordId } from '@wordado/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { renderWith, setup, withProviders } from '../test/fixtures'
import { RESULTS_STEP, Search } from './Search'

afterEach(cleanup)
beforeEach(() => window.history.replaceState(null, '', '/search'))

const field = () => screen.getByRole('searchbox', { name: 'Search the course' })
const type = (text: string) => fireEvent.change(field(), { target: { value: text } })
const rows = () => within(screen.getByRole('list')).getAllByRole('listitem')
const words = () => rows().map((row) => row.querySelector('.word-head')!.textContent)
const status = () => document.querySelector('.search-page [role="status"]')!.textContent
const account = { userId: 'user-1', email: 'learner@example.com' }

describe('Search', () => {
  it('opens with a hint and the field marked to take focus', async () => {
    renderWith(<Search q="" />, await setup())
    expect(screen.getByRole('heading', { level: 1, name: 'Search' })).toBeTruthy()
    expect(screen.getByText('Find any word of the course: by the word, its translation or its note.')).toBeTruthy()
    expect(field().hasAttribute('data-route-focus')).toBe(true)
    expect(screen.queryByRole('list')).toBeNull()
    expect(status()).toBe('')
  })

  it('asks for two letters', async () => {
    renderWith(<Search q="" />, await setup())
    type('t')
    expect(status()).toBe('Type at least two letters.')
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('finds a word by its start, by its translation, and puts the word itself first', async () => {
    renderWith(<Search q="" />, await setup())
    type('teach')
    expect(words()).toEqual(['teacher'])
    expect(status()).toBe('1 word')
    type('учител')
    expect(words()).toEqual(['teacher'])
  })

  it('says where a word is: its level, its unit as a link to the path, its themes', async () => {
    const ctx = await setup()
    renderWith(<Search q="key" />, ctx)
    const corpus = ctx.client.snapshot.corpus!
    const entry = [...corpus.entries.values()].find((e) => e.headword === 'key')!
    const unit = corpus.units.find((u) => u.unitId === entry.unitId)!
    const row = rows().find((r) => r.querySelector('.word-head')!.textContent === 'key')!
    const where = row.querySelector<HTMLElement>('.word-where')!
    expect(within(where).getByText('A1')).toBeTruthy()
    expect(where.querySelector(`a[href="/path?unit=${unit.unitId}"]`)!.textContent).toContain(unit.title.en)
    expect(within(where).getByRole('link', { name: 'Daily life' }).getAttribute('href')).toBe('/themes/daily-life')
  })

  it('names a theme too small to offer without linking to it, and says a locked unit is locked', async () => {
    const ctx = await setup()
    renderWith(<Search q="teacher" />, ctx)
    const corpus = ctx.client.snapshot.corpus!
    const entry = [...corpus.entries.values()].find((e) => e.headword === 'teacher')!
    const where = rows()[0]!.querySelector<HTMLElement>('.word-where')!
    expect(entry.themes.length).toBeGreaterThan(0)
    for (const themeId of entry.themes) {
      expect(where.querySelector(`a[href="/themes/${themeId}"]`)).toBeNull()
      expect(within(where).getByText(corpus.themes.find((theme) => theme.themeId === themeId)!.name.en).tagName).toBe('SPAN')
    }
    const locked = [...corpus.entries.values()].find((e) => !ctx.client.snapshot.path!.unlocked.has(e.unitId))!
    cleanup()
    renderWith(<Search q={locked.headword} />, ctx)
    const title = corpus.units.find((u) => u.unitId === locked.unitId)!.title.en
    expect(screen.getAllByRole('link', { name: `${title}, locked` }).length).toBeGreaterThan(0)
  })

  it('still lists a word whose unit the course does not have, without a unit link', async () => {
    const ctx = await setup()
    const snapshot = ctx.client.snapshot
    const entries = new Map([...snapshot.corpus!.entries].map(([id, e]) => [id, e.headword === 'teacher' ? { ...e, unitId: 'no-such-unit' } : e]))
    ctx.client.store.set({ ...snapshot, corpus: { ...snapshot.corpus!, entries } })
    renderWith(<Search q="teacher" />, ctx)
    expect(words()).toEqual(['teacher'])
    const where = rows()[0]!.querySelector<HTMLElement>('.word-where')!
    expect(within(where).getByText('A1')).toBeTruthy()
    expect(where.querySelector('a[href^="/path"]')).toBeNull()
  })

  it('follows the address when it changes under it', async () => {
    const ctx = await setup()
    const { rerender } = renderWith(<Search q="teacher" />, ctx)
    const again = (ui: ReactElement) => rerender(withProviders(ui, ctx))
    expect(words()).toEqual(['teacher'])
    again(<Search q="key" />)
    expect((field() as HTMLInputElement).value).toBe('key')
    expect(words()).toContain('key')
    expect(words()).not.toContain('teacher')
  })

  it('offers Learn this word on any word found, and marks it', async () => {
    const ctx = await setup()
    renderWith(<Search q="teacher" />, ctx)
    fireEvent.click(screen.getByRole('button', { name: 'Word actions: teacher' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Learn this word: teacher' })))
    const entry = [...ctx.client.snapshot.corpus!.entries.values()].find((e) => e.headword === 'teacher')!
    expect(ctx.client.snapshot.toLearn).toContain(corpusWordId(entry.entryId))
  })

  it('keeps the query in the address, in one history entry', async () => {
    renderWith(<Search q="" />, await setup())
    const before = window.history.length
    type('te')
    type('tea')
    expect(window.location.pathname + window.location.search).toBe('/search?q=tea')
    expect(window.history.length).toBe(before)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(window.location.pathname + window.location.search).toBe('/search')
    expect(document.activeElement).toBe(field())
  })

  it('clears with Escape', async () => {
    renderWith(<Search q="teacher" />, await setup())
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect((field() as HTMLInputElement).value).toBe('')
  })

  it('starts from the address, without taking focus from the page', async () => {
    renderWith(<Search q="teacher" />, await setup())
    expect((field() as HTMLInputElement).value).toBe('teacher')
    expect(field().hasAttribute('data-route-focus')).toBe(false)
    expect(words()).toEqual(['teacher'])
  })

  it('shows thirty results, and thirty more on request, with focus on the first new one', async () => {
    const ctx = await setup()
    // Every word of the sample gets a sense note that one query finds.
    const snapshot = ctx.client.snapshot
    const entries = new Map([...snapshot.corpus!.entries].map(([id, e]) => [id, { ...e, sense: 'qqfind' }]))
    ctx.client.store.set({ ...snapshot, corpus: { ...snapshot.corpus!, entries } })
    renderWith(<Search q="qqfind" />, ctx)
    expect(RESULTS_STEP).toBe(30)
    expect(rows()).toHaveLength(30)
    expect(status()).toBe('60 words')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show more' })))
    expect(rows()).toHaveLength(60)
    expect(rows()[30]!.contains(document.activeElement)).toBe(true)
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('says nothing was found, and signed out, that the sample is small', async () => {
    const ctx = await setup()
    renderWith(<Search q="zzzz" />, ctx)
    expect(status()).toBe('No word in the course matches “zzzz”.')
    expect(screen.getByText('The sample has 60 words. Sign in to search the whole course.')).toBeTruthy()
    cleanup()
    renderWith(<Search q="zzzz" />, { ...ctx, account })
    expect(screen.queryByText(/The sample has/)).toBeNull()
  })

  it('does not find a retired word', async () => {
    const ctx = await setup()
    const snapshot = ctx.client.snapshot
    const entries = new Map([...snapshot.corpus!.entries].map(([id, e]) => [id, e.headword === 'teacher' ? { ...e, retired: true } : e]))
    ctx.client.store.set({ ...snapshot, corpus: { ...snapshot.corpus!, entries } })
    renderWith(<Search q="teacher" />, ctx)
    expect(screen.queryByRole('list')).toBeNull()
  })
})
