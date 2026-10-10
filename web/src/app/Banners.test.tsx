import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NotReady } from '../account/controller'
import { renderToString } from 'react-dom/server'
import { fakeAccounts, fakeFixNotices, fakeLifecycle, renderWith, setup, withProviders } from '../test/fixtures'
import { Banners, SyncLine } from './Banners'

afterEach(cleanup)

const ana = { userId: 'u1', email: 'ana@example.com' }

describe('Banners', () => {
  it('offers an account from the demo, and leaving it after a confirmation', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts()
    renderWith(<Banners />, { ...ctx, accounts })
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/signin')
    const leave = screen.getByRole('button', { name: 'Leave the demo' })
    leave.focus()
    fireEvent.click(leave)
    const dialog = screen.getByRole('dialog', { name: 'Leave the demo?' })
    expect(dialog.textContent).toContain('can’t be undone')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Leave the demo' }))
    expect(accounts.calls).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Leave the demo' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete the demo' })))
    expect(accounts.calls).toEqual(['leaveDemo'])
  })

  it('offers feedback from the demo, naming the screen it is opened from without its query; a learner finds it in the account menu', async () => {
    window.history.replaceState(null, '', '/practice/words?unit=a1-02&mode=flashcard')
    try {
      const ctx = await setup()
      renderWith(<Banners />, { ...ctx })
      expect(screen.getByRole('link', { name: 'Feedback' }).getAttribute('href')).toBe('/feedback?from=%2Fpractice%2Fwords')
      cleanup()
      renderWith(<Banners />, { ...ctx, account: ana })
      expect(screen.queryByRole('link', { name: 'Feedback' })).toBeNull()
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('shows why leaving failed, in the dialog', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts({ leaveDemo: async () => Promise.reject(new Error('disk full')) })
    renderWith(<Banners />, { ...ctx, accounts })
    fireEvent.click(screen.getByRole('button', { name: 'Leave the demo' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete the demo' })))
    expect(screen.getByRole('alert').textContent).toBe('That didn’t work: Something went wrong. Try again.')
  })

  it('says Wordado is still opening, in the learner’s words, when the controller is not ready', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts({ leaveDemo: async () => Promise.reject(new NotReady()) })
    renderWith(<Banners />, { ...ctx, accounts })
    fireEvent.click(screen.getByRole('button', { name: 'Leave the demo' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete the demo' })))
    expect(screen.getByRole('alert').textContent).toBe('That didn’t work: Wordado is still opening. Try again in a moment.')
  })

  it('says a learner on the in-memory fallback must stay online (spec §9.1)', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx, backend: 'memory', account: ana })
    expect(screen.getByText(/Each answer is sent to your account as you go/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Create an account' })).toBeNull()
  })

  it('keeps 6a’s warning for a demo on the in-memory fallback', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx, backend: 'memory' })
    expect(screen.getByText(/can’t keep your progress. Everything you study here is lost/)).toBeTruthy()
  })

  it('says an expired sign-in keeps progress, with a way to sign in again', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts()
    accounts.store.set({ expired: true, notice: null })
    renderWith(<Banners />, { ...ctx, accounts, account: ana })
    expect(screen.getByText(/Your sign-in has expired/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe('/signin')
  })

  it('announces a notice and dismisses it', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts()
    accounts.store.set({ expired: false, notice: 'other-account' })
    renderWith(<Banners />, { ...ctx, accounts, account: ana })
    expect(screen.getByText(/This device holds the progress of ana@example.com/).closest('[role="status"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(accounts.calls).toEqual(['dismissNotice'])
  })

  it('tells the learner that the one thing they reported is fixed, naming the word, and dismisses it', async () => {
    const ctx = await setup()
    const fixNotices = fakeFixNotices([{ reportKey: 'k1', field: 'translation', headword: 'bank' }])
    renderWith(<Banners />, { ...ctx, fixNotices })
    expect(screen.getByText('You reported the translation of “bank”. It is fixed now. Thank you!')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(fixNotices.dismissed).toBe(1)
  })

  it('counts several fixed reports, or one whose word is gone', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx, fixNotices: fakeFixNotices([{ reportKey: 'k1', field: 'audio', headword: null }]) })
    expect(screen.getByText('We fixed 1 thing you reported. Thank you!')).toBeTruthy()
  })

  it('shows the sync status to a learner and nothing in the demo', async () => {
    const ctx = await setup()
    const { unmount } = renderWith(<SyncLine />, { ...ctx })
    expect(screen.queryByText(/sync/i)).toBeNull()
    unmount()
    const accounts = fakeAccounts()
    accounts.store.set({ expired: true, notice: null })
    renderWith(<SyncLine />, { ...ctx, accounts, account: ana })
    expect(screen.getByText('Sign in again to sync')).toBeTruthy()
  })
})

describe('update and install banners (spec §9.1)', () => {
  it('offers a waiting version', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle({ updateReady: true })
    renderWith(<Banners />, { ...ctx, lifecycle })
    expect(screen.getByText('A new version of Wordado is ready.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    expect(lifecycle.calls).toEqual(['applyUpdate'])
  })

  it('says the app is too old when the server refuses this build', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx, lifecycle: fakeLifecycle({ appTooOld: true }) })
    expect(screen.getByText(/too old for the newest words or for syncing/)).toBeTruthy()
  })

  it('keeps the button while an automatic update waits for a safe moment', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle({ updateReady: true, autoUpdate: true })
    renderWith(<Banners />, { ...ctx, lifecycle })
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    expect(lifecycle.calls).toEqual(['applyUpdate'])
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('shows that the app is updating, with a bar that claims no share, and no button to press twice', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx, lifecycle: fakeLifecycle({ updateReady: true, applying: true }) })
    expect(screen.getByText('Updating Wordado…')).toBeTruthy()
    const bar = screen.getByRole('progressbar', { name: 'Updating Wordado…' })
    expect(bar.hasAttribute('aria-valuenow')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull()
  })

  it('shows a new version downloading: no share claimed until its worker reports, then files cached of files listed', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle({ download: { done: 0, total: 0 } })
    renderWith(<Banners />, { ...ctx, lifecycle })
    expect(screen.getByText('Downloading a new version of Wordado…')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Downloading a new version of Wordado…' }).hasAttribute('aria-valuenow')).toBe(false)
    act(() => lifecycle.store.set({ ...lifecycle.store.get(), download: { done: 12, total: 48 } }))
    const bar = screen.getByRole('progressbar', { name: 'Downloading a new version of Wordado…' })
    expect(bar.getAttribute('aria-valuenow')).toBe('12')
    expect(bar.getAttribute('aria-valuemax')).toBe('48')
    expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull()
    // A version that is needed keeps its banner and button while it downloads.
    act(() => lifecycle.store.set({ ...lifecycle.store.get(), appTooOld: true }))
    expect(screen.getByRole('button', { name: 'Update now' })).toBeTruthy()
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  it('says once that Wordado was updated, until it is dismissed', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle({ updated: true })
    renderWith(<Banners />, { ...ctx, lifecycle })
    expect(screen.getByText('Wordado was updated.').closest('[role="status"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(lifecycle.calls).toEqual(['dismissUpdated'])
    expect(screen.queryByText('Wordado was updated.')).toBeNull()
  })

  it('puts that line into a status region that was there first, empty, so that it is announced', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle({ updated: true })
    // The first render, before any effect has run: the region, and nothing in it yet.
    const first = renderToString(withProviders(<Banners />, { ...ctx, lifecycle }))
    expect(first).toContain('<div role="status"></div>')
    expect(first).not.toContain('Wordado was updated.')
    // Nothing to say: the region stays, empty.
    renderWith(<Banners />, { ...ctx, lifecycle: fakeLifecycle() })
    expect(document.querySelector('.banners > [role="status"]:empty')).toBeTruthy()
  })

  it('offers installation, and "Not now"', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle({ installable: 'prompt', installOffer: 'prompt' })
    renderWith(<Banners />, { ...ctx, lifecycle })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Install' })))
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(lifecycle.calls).toEqual(['install', 'dismissInstall'])
  })

  it('tells iOS how to install', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx, lifecycle: fakeLifecycle({ installable: 'ios', installOffer: 'ios' }) })
    expect(screen.getByText(/tap Share, then Add to Home Screen/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })
})
