import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeAccounts, fakeLifecycle, renderWith, setup } from '../test/fixtures'
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

  it('shows why leaving failed, in the dialog', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts({ leaveDemo: async () => Promise.reject(new Error('disk full')) })
    renderWith(<Banners />, { ...ctx, accounts })
    fireEvent.click(screen.getByRole('button', { name: 'Leave the demo' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete the demo' })))
    expect(screen.getByRole('alert').textContent).toBe('That didn’t work: disk full')
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
    expect(screen.getByRole('status').textContent).toContain('This device holds the progress of ana@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(accounts.calls).toEqual(['dismissNotice'])
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
