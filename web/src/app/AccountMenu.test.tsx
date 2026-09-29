import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SignOutOffline } from '../account/controller'
import { fakeAccounts, renderWith, setup } from '../test/fixtures'
import { AccountMenu } from './AccountMenu'

afterEach(cleanup)

const ana = { userId: 'u1', email: 'ana@example.com' }

describe('AccountMenu', () => {
  it('offers signing in in the demo', async () => {
    const ctx = await setup()
    renderWith(<AccountMenu />, { ...ctx })
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/signin')
    expect(screen.queryByRole('button', { name: /Account/ })).toBeNull()
  })

  it('shows who is signed in as a circle with the first letter of the email', async () => {
    const ctx = await setup()
    renderWith(<AccountMenu />, { ...ctx, account: ana })
    const circle = screen.getByRole('button', { name: 'Account: ana@example.com' })
    expect(circle.textContent).toBe('A')
    expect(circle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('opens a menu with the email, settings and signing out; Escape closes it and returns focus', async () => {
    const ctx = await setup()
    renderWith(<AccountMenu />, { ...ctx, account: ana })
    const circle = screen.getByRole('button', { name: 'Account: ana@example.com' })
    fireEvent.click(circle)
    expect(circle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('ana@example.com')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Account settings' }).getAttribute('href')).toBe('/settings')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('link', { name: 'Account settings' }), { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(document.activeElement).toBe(circle)
  })

  it('closes on a click outside and after choosing an item', async () => {
    const ctx = await setup()
    renderWith(<AccountMenu />, { ...ctx, account: ana })
    const circle = screen.getByRole('button', { name: 'Account: ana@example.com' })
    fireEvent.click(circle)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('link', { name: 'Account settings' })).toBeNull()
    fireEvent.click(circle)
    fireEvent.click(screen.getByRole('link', { name: 'Account settings' }))
    expect(screen.queryByRole('link', { name: 'Account settings' })).toBeNull()
  })

  it('signs out, and asks first when answers could not be synced', async () => {
    const ctx = await setup()
    let first = true
    const accounts = fakeAccounts({
      signOut: async (options) => {
        accounts.calls.push(`signOut${options?.force ? ' force' : ''}`)
        if (first && !options?.force) {
          first = false
          return 'unsynced'
        }
        return 'signed-out'
      },
    })
    renderWith(<AccountMenu />, { ...ctx, account: ana, accounts })
    fireEvent.click(screen.getByRole('button', { name: 'Account: ana@example.com' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))
    expect(screen.getByRole('dialog', { name: 'Some answers haven’t synced' })).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out and delete them' })))
    expect(accounts.calls).toEqual(['signOut', 'signOut force'])
  })

  it('says signing out needs a connection and keeps the menu open', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts({
      signOut: async () => {
        throw new SignOutOffline(new Error('offline'))
      },
    })
    renderWith(<AccountMenu />, { ...ctx, account: ana, accounts })
    fireEvent.click(screen.getByRole('button', { name: 'Account: ana@example.com' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))
    expect(screen.getByRole('alert').textContent).toBe('Signing out needs a connection. Your progress stays on this device.')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('marks the circle when sync needs attention and says why in the menu', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts()
    accounts.store.set({ expired: true, notice: null })
    const { container } = renderWith(<AccountMenu />, { ...ctx, account: ana, accounts })
    const circle = screen.getByRole('button', { name: 'Account: ana@example.com. Sign in again to sync' })
    expect(container.querySelector('.account-dot')).not.toBeNull()
    fireEvent.click(circle)
    expect(screen.getByText('Sign in again to sync')).toBeTruthy()
  })

  it('has no mark when sync is fine', async () => {
    const ctx = await setup()
    const { container } = renderWith(<AccountMenu />, { ...ctx, account: ana })
    expect(container.querySelector('.account-dot')).toBeNull()
  })
})
