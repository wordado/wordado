import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, PasskeyCancelled, type PasskeyInfo } from '../account/api'
import { fakeApi } from '../test/fakeApi'
import { renderWith, setup } from '../test/fixtures'
import { AccountSettings } from './AccountSettings'
import { Passkeys } from './Passkeys'

beforeEach(() => window.history.replaceState(null, '', '/settings/account'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ana = { userId: 'u1', email: 'ana@example.com' }

const JAN = Date.UTC(2026, 0, 5, 12)
const MAR = Date.UTC(2026, 2, 9, 12)
const two: readonly PasskeyInfo[] = [
  { id: 'p1', credentialId: 'cred-1', createdAt: JAN },
  { id: 'p2', credentialId: 'cred-2', createdAt: MAR },
]

function browser(platform = true) {
  vi.stubGlobal('PublicKeyCredential', { isUserVerifyingPlatformAuthenticatorAvailable: async () => platform })
}

/** Renders the part and lets the list and the platform check arrive. */
async function show(api = fakeApi({ listPasskeys: async () => two }), account: typeof ana | null = ana) {
  const ctx = await setup()
  await act(async () => {
    renderWith(<Passkeys />, { ...ctx, account, api })
  })
  return api
}

describe('Settings: passkeys (#287)', () => {
  it('lists the passkeys by the day they were added, oldest first', async () => {
    browser()
    await show()
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toContain('Passkey added on January 5, 2026')
    expect(items[1]).toContain('Passkey added on March 9, 2026')
    expect(screen.getByRole('heading', { name: 'Passkeys' })).toBeTruthy()
  })

  it('formats the day for the interface language', async () => {
    browser()
    const ctx = await setup()
    await act(async () => {
      renderWith(<Passkeys />, { ...ctx, locale: 'de', account: ana, api: fakeApi({ listPasskeys: async () => two }) })
    })
    expect(screen.getAllByRole('listitem')[0]?.textContent).toContain('Passkey hinzugefügt am 5. Januar 2026')
  })

  it('says what a passkey is when there is none, and still offers to add one', async () => {
    browser()
    await show(fakeApi({ listPasskeys: async () => [] }))
    expect(screen.getByText(/A passkey lets your device/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add a passkey on this device' })).toBeTruthy()
  })

  it('asks once before removing, then deletes, lists again, tells the device and says it stays in the password manager', async () => {
    browser()
    let rows = two
    const api = fakeApi({
      listPasskeys: async () => rows,
      deletePasskey: async (id) => {
        api.calls.push(`deletePasskey ${id}`)
        rows = rows.filter((p) => p.id !== id)
      },
    })
    await show(api)
    fireEvent.click(screen.getByRole('button', { name: 'Remove the passkey added on January 5, 2026' }))
    expect(screen.getByText('Remove this passkey? It will no longer sign you in.')).toBeTruthy()
    expect(api.calls.some((c) => c.startsWith('deletePasskey'))).toBe(false)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove' })))
    expect(api.calls).toContain('deletePasskey p1')
    expect(api.calls).toContain('signalGone cred-1')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText(/stays in your device’s password manager/)).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Passkeys' }))
  })

  it('keeps the success message when the list cannot be fetched after an add', async () => {
    browser()
    let calls = 0
    await show(
      fakeApi({
        listPasskeys: async () => {
          if (++calls > 1) throw new Error('offline')
          return two
        },
      }),
    )
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add a passkey on this device' })))
    expect(screen.getByText('Passkey added. Next time, sign in with it.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the passkey when the learner cancels the confirmation', async () => {
    browser()
    const api = await show()
    fireEvent.click(screen.getByRole('button', { name: 'Remove the passkey added on January 5, 2026' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.calls.some((c) => c.startsWith('deletePasskey'))).toBe(false)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('shows the add button only with a platform authenticator', async () => {
    browser(false)
    await show()
    expect(screen.queryByRole('button', { name: 'Add a passkey on this device' })).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('adds a passkey and lists again', async () => {
    browser()
    let rows: readonly PasskeyInfo[] = [two[0]!]
    const api = fakeApi({
      listPasskeys: async () => rows,
      passkeyRegister: async () => {
        api.calls.push('passkeyRegister')
        rows = two
      },
    })
    await show(api)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add a passkey on this device' })))
    expect(api.calls).toContain('passkeyRegister')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Passkey added. Next time, sign in with it.')).toBeTruthy()
  })

  it('says nothing when the learner cancels the device prompt, and a line when it fails', async () => {
    browser()
    let fail: Error = new PasskeyCancelled()
    await show(
      fakeApi({
        listPasskeys: async () => two,
        passkeyRegister: async () => {
          throw fail
        },
      }),
    )
    const add = () => screen.getByRole('button', { name: 'Add a passkey on this device' })
    await act(async () => fireEvent.click(add()))
    expect(screen.queryByRole('alert')).toBeNull()
    fail = new ApiError(500, 'FAILED_TO_VERIFY_REGISTRATION')
    await act(async () => fireEvent.click(add()))
    expect(screen.getByRole('alert').textContent).toBe('The passkey was not added.')
  })

  it('asks for a sign-in with a code when the session is not fresh, with a link to it', async () => {
    browser()
    await show(
      fakeApi({
        listPasskeys: async () => two,
        passkeyRegister: async () => {
          throw new ApiError(403, 'SESSION_NOT_FRESH')
        },
      }),
    )
    // The region is there before it says anything, so a screen reader announces what fills it (#302).
    expect(screen.getByRole('status').textContent).toBe('')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add a passkey on this device' })))
    expect(screen.getByRole('status').textContent).toBe('For your safety, sign in again with a code to add a passkey. Sign in')
    // The sign-in returns here, to Settings › Account (#302).
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/signin?back=account')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not list again after an add that failed (#302)', async () => {
    browser()
    const api = fakeApi({
      listPasskeys: async () => {
        api.calls.push('listPasskeys')
        return two
      },
      passkeyRegister: async () => {
        throw new ApiError(500, 'FAILED_TO_VERIFY_REGISTRATION')
      },
    })
    await show(api)
    expect(api.calls.filter((c) => c === 'listPasskeys')).toHaveLength(1)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add a passkey on this device' })))
    expect(api.calls.filter((c) => c === 'listPasskeys')).toHaveLength(1)
  })

  it('keeps the add button off until the new passkey is listed (#302)', async () => {
    browser()
    let release: () => void = () => {}
    let rows: readonly PasskeyInfo[] = [two[0]!]
    let registered = false
    const api = fakeApi({
      listPasskeys: () => (registered ? new Promise((resolve) => (release = () => resolve((rows = two)))) : Promise.resolve(rows)),
      passkeyRegister: async () => {
        registered = true
      },
    })
    await show(api)
    const add = () => screen.getByRole('button', { name: 'Add a passkey on this device' }) as HTMLButtonElement
    await act(async () => fireEvent.click(add()))
    expect(add().disabled).toBe(true)
    await act(async () => release())
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(add().disabled).toBe(false)
  })

  it('builds the date format once for the language, not once per date (#302)', async () => {
    browser()
    const made = vi.spyOn(Intl, 'DateTimeFormat')
    await show()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(made).toHaveBeenCalledTimes(1)
  })

  it('disables adding and removing offline, as the neighbouring controls are', async () => {
    browser()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const api = await show()
    expect((screen.getByRole('button', { name: 'Add a passkey on this device' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Connect to add or remove passkeys.')).toBeTruthy()
    expect(api.calls).not.toContain('listPasskeys')
  })

  it('renders nothing about passkeys where the browser cannot do them', async () => {
    const ctx = await setup()
    renderWith(<AccountSettings />, { ...ctx, account: ana, api: fakeApi() })
    expect(screen.queryByRole('heading', { name: 'Passkeys' })).toBeNull()
  })

  it('is part of the account settings where the browser can do them', async () => {
    browser()
    const ctx = await setup()
    await act(async () => {
      renderWith(<AccountSettings />, { ...ctx, account: ana, api: fakeApi({ listPasskeys: async () => two }) })
    })
    expect(screen.getByRole('heading', { name: 'Passkeys' })).toBeTruthy()
  })
})
