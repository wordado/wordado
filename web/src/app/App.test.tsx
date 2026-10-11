import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { navigate } from '../router'
import { renderWith, setup } from '../test/fixtures'
import { App } from './App'

afterEach(cleanup)
beforeEach(() => window.history.replaceState(null, '', '/'))

const app = (over: { readonly setup?: boolean } = {}) => <App resumed={false} setup={over.setup ?? false} onFinishSetup={() => undefined} />

describe('the search button', () => {
  it('stands in the top row and leads to the search', async () => {
    renderWith(app(), await setup())
    const link = screen.getByRole('link', { name: 'Search' })
    expect(link.getAttribute('href')).toBe('/search')
    expect(link.closest('.masthead-actions')).toBeTruthy()
    expect(link.getAttribute('aria-current')).toBeNull()
    await act(async () => fireEvent.click(link))
    expect(screen.getByRole('heading', { level: 1, name: 'Search' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Search' }).getAttribute('aria-current')).toBe('page')
  })

  it('is not offered during the first-run setup', async () => {
    renderWith(app({ setup: true }), await setup())
    expect(screen.queryByRole('link', { name: 'Search' })).toBeNull()
  })

  it('is not there while studying: the masthead steps aside', async () => {
    window.history.replaceState(null, '', '/study')
    renderWith(app(), await setup())
    expect(screen.queryByRole('link', { name: 'Search' })).toBeNull()
  })
})

describe('focus on the search screen', () => {
  it('goes to the field on arrival, and stays there while the address follows the typing', async () => {
    renderWith(app(), await setup())
    await act(async () => navigate({ name: 'search', q: '' }))
    const field = screen.getByRole('searchbox', { name: 'Search the course' })
    expect(document.activeElement).toBe(field)
    await act(async () => fireEvent.change(field, { target: { value: 'te' } }))
    await act(async () => fireEvent.change(field, { target: { value: 'tea' } }))
    expect(window.location.search).toBe('?q=tea')
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search the course' }))
  })

  it('goes to the page when it arrives with a query, as on any screen', async () => {
    renderWith(app(), await setup())
    await act(async () => navigate({ name: 'search', q: 'teacher' }))
    expect(document.activeElement).toBe(document.getElementById('main'))
  })

  it('goes to the unit when the path opens at one', async () => {
    const ctx = await setup()
    renderWith(app(), ctx)
    const unit = ctx.client.snapshot.corpus!.units.find((u) => u.title.en === 'Food and drink')!
    await act(async () => navigate({ name: 'path', unit: unit.unitId }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Food and drink' }))
  })
})
