import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiError, OfflineError } from '../account/api'
import { fakeApi } from '../test/fakeApi'
import { answerNew, fakeAccounts, renderWith, setup } from '../test/fixtures'
import { SignIn } from './SignIn'

beforeEach(() => window.history.replaceState(null, '', '/signin'))
afterEach(cleanup)

const THIS_YEAR = new Date().getFullYear()

async function render(options: Parameters<typeof fakeAccounts>[0] = {}, apiOver: Parameters<typeof fakeApi>[0] = {}) {
  const ctx = await setup()
  const api = fakeApi(apiOver)
  const accounts = fakeAccounts(options)
  const redirects: string[] = []
  const pending: { country: string | null }[] = []
  renderWith(<SignIn redirect={(url) => redirects.push(url)} pending={{ save: (p) => pending.push(p) }} />, { ...ctx, api, accounts })
  // The country pre-fill arrives from the server.
  await act(async () => undefined)
  return { ...ctx, api, accounts, redirects, pending }
}

async function passGate(country: string, year: number) {
  fireEvent.change(screen.getByLabelText('Country where you live'), { target: { value: country } })
  fireEvent.change(screen.getByLabelText('Year of birth'), { target: { value: String(year) } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
}

describe('SignIn: the age gate (spec §11)', () => {
  it('pre-fills the country from the server', async () => {
    await render()
    expect((screen.getByLabelText('Country where you live') as HTMLSelectElement).value).toBe('BG')
  })

  it('refuses a birth year that is not four digits, tied to the field', async () => {
    const { api } = await render()
    await passGate('BG', 20)
    const field = screen.getByLabelText('Year of birth')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Enter the year you were born, as four digits.')
    expect(field.getAttribute('aria-describedby')).toContain(alert.id)
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(api.calls.filter((c) => c.startsWith('sendCode'))).toEqual([])
  })

  it('turns away a learner below their country’s age before anything is sent or stored', async () => {
    const { api, pending } = await render()
    await passGate('DE', THIS_YEAR - 15)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sorry, you can’t create an account yet')
    expect(screen.getByText(/at least 16/)).toBeTruthy()
    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(api.calls).toEqual(['requestCountry'])
    expect(pending).toEqual([])
  })

  it('uses 16 when the learner would rather not say where they live', async () => {
    await render()
    await passGate('', THIS_YEAR - 15)
    expect(screen.getByText(/at least 16/)).toBeTruthy()
  })

  it('keeps a country the learner already chose, even if the pre-fill arrives late', async () => {
    const ctx = await setup()
    let resolveCountry: (found: string | null) => void = () => undefined
    const countryPromise = new Promise<string | null>((resolve) => {
      resolveCountry = resolve
    })
    const api = fakeApi({ requestCountry: () => countryPromise })
    const accounts = fakeAccounts()
    renderWith(<SignIn redirect={() => undefined} pending={{ save: () => undefined }} />, { ...ctx, api, accounts })
    fireEvent.change(screen.getByLabelText('Country where you live'), { target: { value: 'DE' } })
    await act(async () => resolveCountry('BG'))
    expect((screen.getByLabelText('Country where you live') as HTMLSelectElement).value).toBe('DE')
  })

  it('keeps "I’d rather not say" even if the pre-fill arrives late', async () => {
    const ctx = await setup()
    let resolveCountry: (found: string | null) => void = () => undefined
    const countryPromise = new Promise<string | null>((resolve) => {
      resolveCountry = resolve
    })
    const api = fakeApi({ requestCountry: () => countryPromise })
    const accounts = fakeAccounts()
    renderWith(<SignIn redirect={() => undefined} pending={{ save: () => undefined }} />, { ...ctx, api, accounts })
    fireEvent.change(screen.getByLabelText('Country where you live'), { target: { value: '' } })
    await act(async () => resolveCountry('BG'))
    expect((screen.getByLabelText('Country where you live') as HTMLSelectElement).value).toBe('')
  })
})

describe('SignIn: a code by email (spec §8.6)', () => {
  it('sends a code, verifies it, and completes the sign-in with the gate’s country', async () => {
    const { api, accounts } = await render()
    await passGate('BG', 1990)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
    expect(api.calls).toContain('sendCode ana@example.com')
    expect(screen.getByText(/We sent a six-digit code to ana@example.com/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '12345' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' })))
    expect(screen.getByRole('alert').textContent).toBe('The code is six digits.')
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' })))
    expect(api.calls).toContain('verifyCode ana@example.com 123456')
    expect(accounts.calls).toEqual(['completeSignIn BG'])
    expect(window.location.pathname).toBe('/')
  })

  it('says what signing in does to the demo before a code is asked for', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 1)
    renderWith(<SignIn redirect={() => undefined} pending={{ save: () => undefined }} />, { ...ctx, api: fakeApi(), accounts: fakeAccounts() })
    await act(async () => undefined)
    await passGate('BG', 1990)
    expect(screen.getByText(/the words you studied in the demo are deleted. A new account keeps them/)).toBeTruthy()
  })

  it.each([
    ['the address limit', new ApiError(429, 'sign_in_email_limit'), 'No code was sent: this address has had too many codes. Try again in an hour.'],
    ['too many requests', new ApiError(429, null), 'Too many attempts. Wait a minute and try again.'],
    ['no connection', new OfflineError(new TypeError('Failed to fetch')), 'Signing in needs a connection. You can keep studying offline.'],
    ['anything else', new ApiError(500, 'internal'), 'Something went wrong. Try again.'],
  ])('explains %s when asking for a code', async (_, error, message) => {
    await render({}, { sendCode: async () => Promise.reject(error) })
    await passGate('BG', 1990)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
    expect(screen.getByRole('alert').textContent).toBe(message)
    expect(screen.getByLabelText('Email')).toBeTruthy()
  })

  it('refuses an email that is not one', async () => {
    const { api } = await render()
    await passGate('BG', 1990)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
    expect(screen.getByRole('alert').textContent).toBe('Enter an email address, like name@example.com.')
    expect(api.calls.some((c) => c.startsWith('sendCode'))).toBe(false)
  })

  it('says a wrong code is wrong, tied to the field, and keeps the learner on the code', async () => {
    const { accounts } = await render({}, { verifyCode: async () => Promise.reject(new ApiError(400, 'INVALID_OTP')) })
    await passGate('BG', 1990)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '000000' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' })))
    const field = screen.getByLabelText('Code')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('That code is wrong or has expired.')
    expect(field.getAttribute('aria-describedby')).toContain(alert.id)
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(accounts.calls).toEqual([])
  })

  it('shows a form error, not the field, when verify fails for a reason other than a wrong code', async () => {
    const { accounts } = await render({}, { verifyCode: async () => Promise.reject(new ApiError(500, 'internal')) })
    await passGate('BG', 1990)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' })))
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong. Try again.')
    const field = screen.getByLabelText('Code')
    expect(field.getAttribute('aria-invalid')).toBeNull()
    expect(accounts.calls).toEqual([])
  })

  it('shows "Signing you in…" only while the code is being verified', async () => {
    const ctx = await setup()
    let resolveVerify: () => void = () => undefined
    const verifyPromise = new Promise<void>((resolve) => {
      resolveVerify = resolve
    })
    const api = fakeApi({ verifyCode: () => verifyPromise })
    const accounts = fakeAccounts()
    renderWith(<SignIn redirect={() => undefined} pending={{ save: () => undefined }} />, { ...ctx, api, accounts })
    await act(async () => undefined)
    await passGate('BG', 1990)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
    expect(screen.queryByText('Signing you in…')).toBeNull()
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await act(async () => undefined)
    expect(screen.getByText('Signing you in…')).toBeTruthy()
    await act(async () => resolveVerify())
  })

  it('does not show "Signing you in…" while a new code is being sent', async () => {
    const ctx = await setup()
    let resolveResend: () => void = () => undefined
    let sends = 0
    const api = fakeApi({
      sendCode: async () => {
        sends += 1
        if (sends === 1) return
        await new Promise<void>((resolve) => {
          resolveResend = resolve
        })
      },
    })
    const accounts = fakeAccounts()
    renderWith(<SignIn redirect={() => undefined} pending={{ save: () => undefined }} />, { ...ctx, api, accounts })
    await act(async () => undefined)
    await passGate('BG', 1990)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }))
    await act(async () => undefined)
    expect(screen.queryByText('Signing you in…')).toBeNull()
    await act(async () => resolveResend())
  })

  it('refuses a second account on a device that holds a learner’s progress', async () => {
    const ctx = await setup()
    renderWith(<SignIn redirect={() => undefined} pending={{ save: () => undefined }} />, {
      ...ctx,
      api: fakeApi(),
      accounts: fakeAccounts({ completeSignIn: async () => 'other-account' }),
      account: { userId: 'u1', email: 'ana@example.com' },
    })
    await act(async () => undefined)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sign in again')
    await passGate('BG', 1990)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bo@example.com' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' })))
    expect(screen.getByRole('alert').textContent).toContain('This device holds the progress of ana@example.com')
  })
})

describe('SignIn: Google (spec §8.6)', () => {
  it('keeps the gate’s country for the return, then goes to Google', async () => {
    const { redirects, pending } = await render()
    await passGate('BG', 1990)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' })))
    expect(pending).toEqual([{ country: 'BG' }])
    expect(redirects).toEqual(['https://accounts.google.com/o/oauth2/auth'])
  })

  it('says so when Google is not available', async () => {
    const { redirects } = await render({}, { googleUrl: async () => Promise.reject(new ApiError(404, 'PROVIDER_NOT_FOUND')) })
    await passGate('BG', 1990)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' })))
    expect(screen.getByRole('alert').textContent).toBe('Google sign-in isn’t available right now. Use a code by email.')
    expect(redirects).toEqual([])
  })
})
