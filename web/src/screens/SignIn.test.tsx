import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiError, OfflineError, type CodeOutcome } from '../account/api'
import { fakeApi } from '../test/fakeApi'
import { answerNew, fakeAccounts, renderWith, setup } from '../test/fixtures'
import { SignIn } from './SignIn'

beforeEach(() => window.history.replaceState(null, '', '/signin'))
afterEach(cleanup)

async function render(options: Parameters<typeof fakeAccounts>[0] = {}, apiOver: Parameters<typeof fakeApi>[0] = {}, codeOutcome?: CodeOutcome) {
  const ctx = await setup()
  const api = fakeApi(apiOver)
  if (codeOutcome) api.codeOutcome = codeOutcome
  const accounts = fakeAccounts(options)
  renderWith(<SignIn />, { ...ctx, api, accounts })
  // The country pre-fill arrives from the server.
  await act(async () => undefined)
  return { ...ctx, api, accounts }
}

/** An address with no account: a right code answers with the ticket for the age step (#293). */
const NEW: CodeOutcome = { kind: 'new-account', ticket: 'tk' }

/** Step 1: the email, and a code is sent. */
async function enterEmail(address = 'ana@example.com') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: address } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
}

/** Step 2: the code from the mail. */
async function enterCode(code = '123456') {
  fireEvent.change(screen.getByLabelText('Code'), { target: { value: code } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' })))
}

/** The email and the code, for an address with no account: the age step follows. */
async function reachGate(address = 'ana@example.com') {
  await enterEmail(address)
  await enterCode()
}

/** The age step: the country, then the age it sets, confirmed, and the account is created. */
async function passGate(country: string) {
  fireEvent.change(screen.getByLabelText('Country where you live'), { target: { value: country } })
  fireEvent.click(screen.getByRole('checkbox', { name: /^I’m \d+ or older$/ }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create account' })))
}

describe('SignIn: email first, the age step only for a new account (#293)', () => {
  it('opens on the email, with no age question', async () => {
    await render()
    expect(screen.getByText('Step 1 of 2')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'How do you want to sign in?' })).toBeTruthy()
    expect(screen.queryByLabelText('Country where you live')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('signs in an account that exists at once after the code, with no age step', async () => {
    const { api, accounts } = await render()
    await enterEmail()
    expect(screen.getByText('Step 2 of 2')).toBeTruthy()
    await enterCode()
    expect(screen.queryByLabelText('Country where you live')).toBeNull()
    expect(api.calls).toEqual(['requestCountry', 'sendCode ana@example.com', 'verifyCode ana@example.com 123456'])
    expect(accounts.calls).toEqual(['completeSignIn'])
    expect(window.location.pathname).toBe('/')
  })

  it('asks the age after the code for an address with no account, names the address, and creates the account once it is confirmed', async () => {
    const { api, accounts } = await render({}, {}, NEW)
    await reachGate()
    expect(screen.getByText('New account')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Create your account' }))
    expect(screen.getByText('There is no account with ana@example.com yet. Confirm your age below to create one, or use another email.')).toBeTruthy()
    expect(accounts.calls).toEqual([])
    const create = screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    await passGate('BG')
    expect(api.calls).toEqual(['requestCountry', 'sendCode ana@example.com', 'verifyCode ana@example.com 123456', 'createAccount ana@example.com tk'])
    expect(accounts.calls).toEqual(['completeSignIn'])
    expect(window.location.pathname).toBe('/')
  })

  it('lets a learner who mistyped the address go back to it, and the ticket is dropped', async () => {
    const { api, accounts } = await render({}, {}, NEW)
    await reachGate('ana@exmaple.com')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use another email' })))
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(api.calls).toContain('discardSignUp ana@exmaple.com tk')
    expect(api.calls.some((c) => c.startsWith('createAccount'))).toBe(false)
    expect(accounts.calls).toEqual([])
  })

  it('goes back to the email with a new code to ask for when the ticket has lapsed', async () => {
    const { accounts } = await render({}, { createAccount: async () => Promise.reject(new ApiError(400, 'INVALID_TICKET')) }, NEW)
    await reachGate()
    await passGate('BG')
    expect(screen.getByRole('alert').textContent).toBe('Creating the account took too long. Ask for a new code and try again.')
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('ana@example.com')
    expect(accounts.calls).toEqual([])
  })

  it('stays on the age step with a form error when creating fails for another reason', async () => {
    const { accounts } = await render({}, { createAccount: async () => Promise.reject(new ApiError(500, 'internal')) }, NEW)
    await reachGate()
    await passGate('BG')
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong. Try again.')
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy()
    expect(accounts.calls).toEqual([])
  })
})

describe('SignIn: the age gate (spec §11)', () => {
  it('pre-fills the country from the server', async () => {
    await render({}, {}, NEW)
    await reachGate()
    expect((screen.getByLabelText('Country where you live') as HTMLSelectElement).value).toBe('BG')
  })

  it('asks to confirm the age the chosen country sets, and creates the account only once it is confirmed', async () => {
    const { api } = await render({}, {}, NEW)
    await reachGate()
    expect(screen.getByRole('checkbox', { name: 'I’m 14 or older' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Country where you live'), { target: { value: 'DE' } })
    const confirm = screen.getByRole('checkbox', { name: 'I’m 16 or older' })
    const go = screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    await act(async () => fireEvent.submit(go.closest('form')!))
    expect(api.calls.some((c) => c.startsWith('createAccount'))).toBe(false)
    fireEvent.click(confirm)
    expect(go.disabled).toBe(false)
    await act(async () => fireEvent.click(go))
    expect(api.calls).toContain('createAccount ana@example.com tk')
  })

  it('turns away a learner below their country’s age: no account, and the server drops the ticket', async () => {
    const { api, accounts } = await render({}, {}, NEW)
    await reachGate()
    fireEvent.change(screen.getByLabelText('Country where you live'), { target: { value: 'DE' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'I’m younger than 16' })))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sorry, you can’t create an account yet')
    expect(screen.getByText(/at least 16/)).toBeTruthy()
    expect(api.calls).toEqual(['requestCountry', 'sendCode ana@example.com', 'verifyCode ana@example.com 123456', 'discardSignUp ana@example.com tk'])
    expect(accounts.calls).toEqual([])
  })

  it('uses 16 when the learner would rather not say where they live', async () => {
    await render({}, {}, NEW)
    await reachGate()
    fireEvent.change(screen.getByLabelText('Country where you live'), { target: { value: '' } })
    expect(screen.getByRole('checkbox', { name: 'I’m 16 or older' })).toBeTruthy()
  })

  it('asks the age afresh for each new address', async () => {
    await render({}, {}, NEW)
    await reachGate()
    fireEvent.click(screen.getByRole('checkbox', { name: 'I’m 14 or older' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use another email' })))
    await reachGate('bo@example.com')
    expect((screen.getByRole('checkbox', { name: 'I’m 14 or older' }) as HTMLInputElement).checked).toBe(false)
  })

  async function renderWithLateCountry() {
    const ctx = await setup()
    let resolveCountry: (found: string | null) => void = () => undefined
    const countryPromise = new Promise<string | null>((resolve) => {
      resolveCountry = resolve
    })
    const api = fakeApi({ requestCountry: () => countryPromise })
    api.codeOutcome = NEW
    renderWith(<SignIn />, { ...ctx, api, accounts: fakeAccounts() })
    await reachGate()
    return (found: string | null) => resolveCountry(found)
  }

  it('keeps a country the learner already chose, even if the pre-fill arrives late', async () => {
    const resolveCountry = await renderWithLateCountry()
    fireEvent.change(screen.getByLabelText('Country where you live'), { target: { value: 'DE' } })
    await act(async () => resolveCountry('BG'))
    expect((screen.getByLabelText('Country where you live') as HTMLSelectElement).value).toBe('DE')
  })

  it('keeps "I’d rather not say" even if the pre-fill arrives late', async () => {
    const resolveCountry = await renderWithLateCountry()
    fireEvent.change(screen.getByLabelText('Country where you live'), { target: { value: '' } })
    await act(async () => resolveCountry('BG'))
    expect((screen.getByLabelText('Country where you live') as HTMLSelectElement).value).toBe('')
  })

  it('keeps the gate’s country on this device: creating the account sends it nowhere (#166)', async () => {
    const { api } = await render({}, {}, NEW)
    await reachGate()
    await passGate('DE')
    expect(api.calls).toEqual(['requestCountry', 'sendCode ana@example.com', 'verifyCode ana@example.com 123456', 'createAccount ana@example.com tk'])
  })
})

describe('SignIn: a code by email (spec §8.6)', () => {
  it('sends a code, verifies it, and completes the sign-in', async () => {
    const { api, accounts } = await render()
    await enterEmail()
    expect(api.calls).toContain('sendCode ana@example.com')
    expect(screen.getByText(/We sent a six-digit code to ana@example.com/)).toBeTruthy()
    await enterCode('12345')
    expect(screen.getByRole('alert').textContent).toBe('The code is six digits.')
    await enterCode('123456')
    expect(api.calls).toContain('verifyCode ana@example.com 123456')
    expect(accounts.calls).toEqual(['completeSignIn'])
    expect(window.location.pathname).toBe('/')
  })

  it('says what signing in does to the demo before a code is asked for', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 1)
    renderWith(<SignIn />, { ...ctx, api: fakeApi(), accounts: fakeAccounts() })
    await act(async () => undefined)
    expect(screen.getByText(/the words you studied in the demo are deleted. A new account keeps them/)).toBeTruthy()
  })

  it('warns whenever the demo holds anything unsynced, not only answers, and not when it holds nothing', async () => {
    const ctx = await setup()
    renderWith(<SignIn />, { ...ctx, api: fakeApi(), accounts: fakeAccounts() })
    await act(async () => undefined)
    expect(screen.queryByText(/the words you studied in the demo are deleted/)).toBeNull()
    cleanup()
    const withSettings = await setup()
    await withSettings.client.updateSettings({ activeTheme: 'daily-life' })
    expect(withSettings.client.snapshot.states.size).toBe(0)
    renderWith(<SignIn />, { ...withSettings, api: fakeApi(), accounts: fakeAccounts() })
    await act(async () => undefined)
    expect(screen.getByText(/the words you studied in the demo are deleted/)).toBeTruthy()
  })

  it.each([
    ['the address limit', new ApiError(429, 'sign_in_email_limit'), 'No code was sent: this address has had too many codes. Try again in an hour.'],
    ['too many requests', new ApiError(429, null), 'Too many attempts. Wait a minute and try again.'],
    ['no connection', new OfflineError(new TypeError('Failed to fetch')), 'Signing in needs a connection. You can keep studying offline.'],
    ['anything else', new ApiError(500, 'internal'), 'Something went wrong. Try again.'],
  ])('explains %s when asking for a code', async (_, error, message) => {
    await render({}, { sendCode: async () => Promise.reject(error) })
    await enterEmail()
    expect(screen.getByRole('alert').textContent).toBe(message)
    expect(screen.getByLabelText('Email')).toBeTruthy()
  })

  it('refuses an email that is not one', async () => {
    const { api } = await render()
    await enterEmail('ana')
    expect(screen.getByRole('alert').textContent).toBe('Enter an email address, like name@example.com.')
    expect(api.calls.some((c) => c.startsWith('sendCode'))).toBe(false)
  })

  it('says a wrong code is wrong, tied to the field, and keeps the learner on the code', async () => {
    const { accounts } = await render({}, { verifyCode: async () => Promise.reject(new ApiError(400, 'INVALID_OTP')) })
    await enterEmail()
    await enterCode('000000')
    const field = screen.getByLabelText('Code')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('That code is wrong or has expired.')
    expect(field.getAttribute('aria-describedby')).toContain(alert.id)
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryByLabelText('Country where you live')).toBeNull()
    expect(accounts.calls).toEqual([])
  })

  it('shows a form error, not the field, when verify fails for a reason other than a wrong code', async () => {
    const { accounts } = await render({}, { verifyCode: async () => Promise.reject(new ApiError(500, 'internal')) })
    await enterEmail()
    await enterCode()
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong. Try again.')
    const field = screen.getByLabelText('Code')
    expect(field.getAttribute('aria-invalid')).toBeNull()
    expect(accounts.calls).toEqual([])
  })

  it('shows "Signing you in…" only while the code is being verified', async () => {
    const ctx = await setup()
    let resolveVerify: () => void = () => undefined
    const verifyPromise = new Promise<{ kind: 'signed-in' }>((resolve) => {
      resolveVerify = () => resolve({ kind: 'signed-in' })
    })
    const api = fakeApi({ verifyCode: () => verifyPromise })
    const accounts = fakeAccounts()
    renderWith(<SignIn />, { ...ctx, api, accounts })
    await act(async () => undefined)
    await enterEmail()
    expect(screen.queryByText('Signing you in…')).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await act(async () => undefined)
    expect(screen.getByText('Signing you in…')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Signing you in…' }).hasAttribute('aria-valuenow')).toBe(false)
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
    renderWith(<SignIn />, { ...ctx, api, accounts })
    await act(async () => undefined)
    await enterEmail()
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }))
    await act(async () => undefined)
    expect(screen.queryByText('Signing you in…')).toBeNull()
    await act(async () => resolveResend())
  })

  it('refuses a second account on a device that holds a learner’s progress', async () => {
    const ctx = await setup()
    renderWith(<SignIn />, {
      ...ctx,
      api: fakeApi(),
      accounts: fakeAccounts({ completeSignIn: async () => 'other-account' }),
      account: { userId: 'u1', email: 'ana@example.com' },
    })
    await act(async () => undefined)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sign in again')
    // The account is there already: nothing to sell it with.
    expect(screen.queryByRole('list', { name: 'With an account' })).toBeNull()
    await enterEmail('bo@example.com')
    await enterCode()
    expect(screen.getByRole('alert').textContent).toContain('This device holds the progress of ana@example.com')
  })
})

describe('SignIn: a learner who comes back (#273, #293)', () => {
  it('says on the first step that the email decides, and that an account that exists is signed in', async () => {
    await render()
    expect(
      screen.getByText(
        'New here or coming back, start with your email. If it already has an account, you are signed in and your progress comes back. If not, you can create one next.',
      ),
    ).toBeTruthy()
  })

  it('says at the email field that the address decides which account it is', async () => {
    await render()
    const email = screen.getByLabelText('Email')
    const hint = document.getElementById(email.getAttribute('aria-describedby') ?? '')
    expect(hint?.textContent).toBe('If you already have an account, use the email it was made with. Another address makes a new account.')
  })

  it('says neither to a learner whose sign-in expired: this device already knows the account', async () => {
    const ctx = await setup()
    renderWith(<SignIn />, { ...ctx, api: fakeApi(), accounts: fakeAccounts(), account: { userId: 'u1', email: 'ana@example.com' } })
    await act(async () => undefined)
    expect(screen.queryByText(/^New here or coming back/)).toBeNull()
    expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toBeNull()
  })
})

describe('SignIn: news by email (#186)', () => {
  const NEWS = 'I would like to receive news about Wordado and its new features by email. I can opt out at any time.'

  it('asks on the age step, under the age confirmation, unticked, and the account does not wait for it', async () => {
    const { api, accounts } = await render({}, {}, NEW)
    await reachGate()
    const news = screen.getByRole('checkbox', { name: NEWS }) as HTMLInputElement
    expect(news.checked).toBe(false)
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.indexOf(news)).toBe(boxes.indexOf(screen.getByRole('checkbox', { name: /^I’m \d+ or older$/ })) + 1)
    await passGate('BG')
    expect(api.calls).toContain('createAccount ana@example.com tk')
    expect(accounts.calls).toEqual(['completeSignIn'])
  })

  it('asks nothing of a returning learner, and sends nothing of it with the code (#293)', async () => {
    const { api } = await render()
    expect(screen.queryByRole('checkbox', { name: NEWS })).toBeNull()
    await enterEmail()
    expect(screen.queryByRole('checkbox', { name: NEWS })).toBeNull()
    await enterCode()
    expect(api.calls).toContain('verifyCode ana@example.com 123456')
  })

  it('says first what an account gives and what the email is for, before the email (#289)', async () => {
    await render()
    const gives = screen.getByRole('list', { name: 'With an account' })
    expect(within(gives).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'The whole course: every level, and its themes.',
      'Your progress kept in your account, on every device you sign in on.',
      'Your email is used only to send you a sign-in code. News only if you ask for it, and you can delete your account at any time.',
    ])
    expect(gives.compareDocumentPosition(screen.getByLabelText('Email')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says what is kept: the country stays on this device, a ticked box goes with the account', async () => {
    await render({}, {}, NEW)
    await reachGate()
    expect(
      screen.getByText(
        'The law sets an age for an account of your own, depending on where you live. Your country stays on this device and is not sent. If you tick the box for news, that choice is saved with your account.',
      ),
    ).toBeTruthy()
  })

  it('sends the wording that was ticked, in the language it was read in, with the request that creates the account', async () => {
    const { api } = await render({}, {}, NEW)
    await reachGate()
    fireEvent.click(screen.getByRole('checkbox', { name: NEWS }))
    await passGate('BG')
    expect(api.calls).toContain('createAccount ana@example.com tk news-1.en')
  })

  it('does not untick the box when the country changes, and sends nothing once the learner unticks it', async () => {
    const { api } = await render({}, {}, NEW)
    await reachGate()
    fireEvent.click(screen.getByRole('checkbox', { name: NEWS }))
    fireEvent.change(screen.getByLabelText('Country where you live'), { target: { value: 'DE' } })
    expect((screen.getByRole('checkbox', { name: NEWS }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: NEWS }))
    await passGate('DE')
    expect(api.calls).toContain('createAccount ana@example.com tk')
  })
})

describe('SignIn: the privacy policy (spec §11)', () => {
  it('links to the policy where the email address is asked for', async () => {
    await render()
    expect(screen.getByRole('link', { name: 'Privacy policy' }).getAttribute('href')).toBe('https://wordado.com/en/privacy/')
  })
})
