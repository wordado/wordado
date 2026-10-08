import { act, cleanup, render, screen } from '@testing-library/react'
import { createStore } from '@wordado/client-data'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { navigate } from '../router'
import { fakeAccounts, fakeLifecycle, fakePacks, renderWith, setup } from '../test/fixtures'
import { useStore } from '../useStore'
import { safeToUpdate, useUpdateHold, useUpdateSafety, type Surroundings } from './updateSafety'

beforeEach(() => window.history.replaceState(null, '', '/'))
afterEach(cleanup)

const idle: Surroundings = { route: 'home', setup: false, backend: 'opfs', installingPack: false, syncing: false, notice: false, document }

describe('a safe moment to update (spec §9.1)', () => {
  it('is any of the app’s own pages with nothing going on', () => {
    for (const route of ['home', 'path', 'themes', 'progress', 'settings', 'practice'] as const) expect(safeToUpdate({ ...idle, route })).toBe(true)
    expect(safeToUpdate({ ...idle, backend: 'idb' })).toBe(true)
  })

  it('is never a run, a board, the placement test, the sign-in or a language change, until that screen is left', () => {
    for (const route of ['study', 'practice-words', 'matching', 'placement', 'signin', 'native-language'] as const) {
      expect(safeToUpdate({ ...idle, route })).toBe(false)
    }
  })

  it('is not the first-run setup, a pack being installed, a sync in flight, or an account notice not yet read', () => {
    expect(safeToUpdate({ ...idle, setup: true })).toBe(false)
    expect(safeToUpdate({ ...idle, installingPack: true })).toBe(false)
    expect(safeToUpdate({ ...idle, syncing: true })).toBe(false)
    expect(safeToUpdate({ ...idle, notice: true })).toBe(false)
  })

  it('is never an in-memory database: a reload there loses what is not yet synced, or the whole demo', () => {
    expect(safeToUpdate({ ...idle, backend: 'memory' })).toBe(false)
  })

  it('is not while a dialog or a menu is open, or a refused value sits in a field', () => {
    const { rerender } = render(<dialog open />)
    expect(safeToUpdate(idle)).toBe(false)
    rerender(
      <header className="masthead">
        <button aria-expanded="true" />
      </header>,
    )
    expect(safeToUpdate(idle)).toBe(false)
    rerender(<button className="word-menu-button" aria-expanded="true" />)
    expect(safeToUpdate(idle)).toBe(false)
    rerender(<input aria-invalid="true" defaultValue="abc" />)
    expect(safeToUpdate(idle)).toBe(false)
    // The path's folds are open by design: not a menu.
    rerender(
      <>
        <header className="masthead">
          <button aria-expanded="false" />
        </header>
        <button className="unit-fold-button" aria-expanded="true" />
      </>,
    )
    expect(safeToUpdate(idle)).toBe(true)
  })

  it('is not while the learner is typing or choosing in a field', () => {
    render(
      <>
        <input aria-label="code" />
        <textarea aria-label="note" />
        <select aria-label="country" />
        <input type="checkbox" aria-label="audio" />
        <button>Start</button>
      </>,
    )
    for (const name of ['code', 'note', 'country']) {
      screen.getByLabelText(name).focus()
      expect(safeToUpdate(idle)).toBe(false)
    }
    // A switch saves as it is pressed, and a button holds nothing.
    screen.getByLabelText('audio').focus()
    expect(safeToUpdate(idle)).toBe(true)
    screen.getByRole('button').focus()
    expect(safeToUpdate(idle)).toBe(true)
  })
})

function Shell(props: { readonly setup?: boolean }) {
  useUpdateSafety(props.setup ?? false)
  return null
}

describe('the shell’s guard (spec §9.1)', () => {
  it('says it is safe on today, not in a run, and safe again once the run is left; and nothing is safe once it is gone', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle()
    const { unmount } = renderWith(<Shell />, { ...ctx, lifecycle })
    expect(lifecycle.safe?.()).toBe(true)
    act(() => navigate({ name: 'study', mode: null }))
    expect(lifecycle.safe?.()).toBe(false)
    act(() => navigate({ name: 'home' }))
    expect(lifecycle.safe?.()).toBe(true)
    unmount()
    expect(lifecycle.safe).toBeNull()
  })

  it('follows the setup, the storage, a pack being installed and an account notice', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle()
    const packs = fakePacks()
    const accounts = fakeAccounts()
    const inSetup = renderWith(<Shell setup />, { ...ctx, lifecycle, packs, accounts })
    expect(lifecycle.safe?.()).toBe(false)
    inSetup.unmount()
    const after = renderWith(<Shell />, { ...ctx, lifecycle, packs, accounts })
    expect(lifecycle.safe?.()).toBe(true)
    packs.store.set({ phase: 'downloading', client: ctx.client, l1: 'de', received: 0, total: 0 })
    expect(lifecycle.safe?.()).toBe(false)
    packs.store.set({ phase: 'idle' })
    accounts.store.set({ expired: false, notice: 'signed-in' })
    expect(lifecycle.safe?.()).toBe(false)
    after.unmount()
    const memory = fakeLifecycle()
    renderWith(<Shell />, { ...ctx, lifecycle: memory, backend: 'memory' })
    expect(memory.safe?.()).toBe(false)
  })

  it('holds the update while work is in flight, and lets go when it ends', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle()
    const work = createStore(true)
    function Work() {
      useUpdateHold(useStore(work))
      return null
    }
    const { unmount } = renderWith(<Work />, { ...ctx, lifecycle })
    expect(lifecycle.holds).toBe(1)
    act(() => work.set(false))
    expect(lifecycle.holds).toBe(0)
    act(() => work.set(true))
    expect(lifecycle.holds).toBe(1)
    unmount()
    expect(lifecycle.holds).toBe(0)
  })

  it('passes on that the server refused this build, so the newer app is fetched', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle()
    renderWith(<Shell />, { ...ctx, lifecycle })
    expect(lifecycle.calls).toEqual([])
    const snapshot = ctx.client.store.get()
    vi.spyOn(ctx.client, 'snapshot', 'get').mockReturnValue({ ...snapshot, sync: { ...snapshot.sync, upgradeRequired: true } })
    act(() => ctx.client.store.set(ctx.client.store.get()))
    expect(lifecycle.calls).toContain('markAppTooOld')
  })
})
