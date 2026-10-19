import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, OfflineError, PasskeyCancelled, type CodeOutcome } from '../account/api'
import { offerAnswered, offerPending } from '../account/passkeys'
import { memoryStorage, type KeyValue } from '../account/storage'
import { fakeApi } from '../test/fakeApi'
import { answerNew, fakeAccounts, renderWith, setup } from '../test/fixtures'
import { App } from '../app/App'
import { SignIn } from './SignIn'

/** This device's own values (the answer to the passkey offer), fresh for each test. */
let device: KeyValue = memoryStorage()

beforeEach(() => {
  window.history.replaceState(null, '', '/signin')
  device = memoryStorage()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  offerPending.set(false)
})

async function render(options: Parameters<typeof fakeAccounts>[0] = {}, apiOver: Parameters<typeof fakeApi>[0] = {}, codeOutcome?: CodeOutcome) {
  const ctx = await setup()
  const api = fakeApi(apiOver)
  if (codeOutcome) api.codeOutcome = codeOutcome
  const accounts = fakeAccounts(options)
  renderWith(<SignIn deviceStore={device} />, { ...ctx, api, accounts })
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

  it('says what an account gives and what the email is for, right under the email form (#289, #296)', async () => {
    await render()
    const gives = screen.getByRole('list', { name: 'With an account' })
    expect(within(gives).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'The whole course: every level, and its themes.',
      'Your progress kept in your account, on every device you sign in on.',
      'Your email is used to send you a sign-in code and to tell you about important changes to the service. News only if you ask for it, and you can delete your account at any time.',
    ])
    expect(gives.compareDocumentPosition(screen.getByLabelText('Email')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
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

/** A browser that can do passkeys: a platform authenticator (fingerprint, face, PIN) and autofill, as the test says. */
function passkeyBrowser(options: { platform?: boolean; conditional?: boolean } = {}) {
  vi.stubGlobal('PublicKeyCredential', {
    isUserVerifyingPlatformAuthenticatorAvailable: async () => options.platform ?? true,
    isConditionalMediationAvailable: async () => options.conditional ?? false,
  })
}

const ANA = { userId: 'u1', email: 'ana@example.com' }

const OFFER = 'Sign in faster next time'

async function pressPasskey() {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' })))
}

describe('SignIn: a passkey (#287)', () => {
  it('shows no passkey button where the browser cannot do passkeys', async () => {
    await render()
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).toBeNull()
    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('email')
  })

  it('offers the passkey button on the first step only, below the email form', async () => {
    passkeyBrowser()
    await render()
    const button = screen.getByRole('button', { name: 'Sign in with a passkey' })
    expect(screen.getByRole('button', { name: 'Email me a code' }).compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await enterEmail()
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).toBeNull()
  })

  it('says under the button where a passkey comes from, and that it lives in the password manager that saved it (#308)', async () => {
    passkeyBrowser()
    await render()
    const button = screen.getByRole('button', { name: 'Sign in with a passkey' })
    expect(button.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      'No passkey here yet? Sign in with a code, then add one in Settings › Account. A passkey works only in the password manager that saved it.',
    )
  })

  it('says nothing about passkeys where the browser cannot do them (#308)', async () => {
    await render()
    expect(screen.queryByText(/No passkey here yet/)).toBeNull()
  })

  it('signs in with the passkey, completes the sign-in as a code does, and goes home with no offer', async () => {
    passkeyBrowser({ platform: true })
    const { api, accounts } = await render()
    await pressPasskey()
    expect(api.calls).toEqual(['requestCountry', 'passkeySignIn button'])
    expect(accounts.calls).toEqual(['completeSignIn'])
    expect(offerPending.get()).toBe(false)
    expect(window.location.pathname).toBe('/')
  })

  it.each([
    ['a cancelled prompt', new PasskeyCancelled(), null],
    ['a removed passkey', new ApiError(401, 'PASSKEY_NOT_FOUND'), 'This passkey no longer works. Sign in with a code, then you can add a new one.'],
    ['too many requests', new ApiError(429, null), 'Too many attempts. Wait a minute and try again.'],
    ['no connection', new OfflineError(new TypeError('Failed to fetch')), 'Signing in needs a connection. You can keep studying offline.'],
    ['a failed check', new ApiError(400, 'AUTHENTICATION_FAILED'), 'Something went wrong. Try again.'],
    ['no device unlock', new ApiError(401, 'USER_NOT_VERIFIED'), 'Something went wrong. Try again.'],
  ])('after %s, stays on the email and says what it should', async (_, error, message) => {
    passkeyBrowser()
    const { accounts } = await render({}, { passkeySignIn: async () => Promise.reject(error) })
    await pressPasskey()
    if (message === null) expect(screen.queryByRole('alert')).toBeNull()
    else expect(screen.getByRole('alert').textContent).toBe(message)
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(accounts.calls).toEqual([])
    expect(window.location.pathname).toBe('/signin')
  })

  it('refuses a passkey of another account on a device that holds a learner’s progress, as a code', async () => {
    passkeyBrowser()
    const ctx = await setup()
    const accounts = fakeAccounts({
      completeSignIn: async () => {
        accounts.calls.push('completeSignIn')
        return 'other-account'
      },
    })
    renderWith(<SignIn deviceStore={device} />, { ...ctx, api: fakeApi(), accounts, account: ANA })
    await act(async () => undefined)
    await pressPasskey()
    expect(accounts.calls).toEqual(['completeSignIn'])
    expect(screen.getByRole('alert').textContent).toContain('This device holds the progress of ana@example.com')
    expect(window.location.pathname).toBe('/signin')
  })

  it('takes a demo with progress the same way as a code: the sign-in decides what is kept', async () => {
    passkeyBrowser()
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 1)
    const accounts = fakeAccounts()
    renderWith(<SignIn deviceStore={device} />, { ...ctx, api: fakeApi(), accounts })
    await act(async () => undefined)
    expect(screen.getByText(/the words you studied in the demo are deleted/)).toBeTruthy()
    await pressPasskey()
    expect(accounts.calls).toEqual(['completeSignIn'])
    expect(window.location.pathname).toBe('/')
  })
})

describe('SignIn: the conditional request comes back after a failure (#287)', () => {
  /** Counts the conditional requests; each waits until aborted. */
  function countingApi(apiOver: Parameters<typeof fakeApi>[0] = {}) {
    const conditional: AbortSignal[] = []
    const api = fakeApi({
      passkeySignIn: ({ conditional: c, signal }) => {
        if (!c) return Promise.resolve()
        if (signal) conditional.push(signal)
        return new Promise<void>((_, reject) => signal?.addEventListener('abort', () => reject(new PasskeyCancelled())))
      },
      ...apiOver,
    })
    return { api, conditional }
  }

  it('waits in the field again after a code could not be sent', async () => {
    passkeyBrowser({ conditional: true })
    const ctx = await setup()
    const { api, conditional } = countingApi({ sendCode: async () => Promise.reject(new ApiError(500, null)) })
    renderWith(<SignIn deviceStore={device} />, { ...ctx, api, accounts: fakeAccounts() })
    await act(async () => undefined)
    expect(conditional).toHaveLength(1)
    await enterEmail()
    expect(conditional[0]!.aborted).toBe(true)
    expect(conditional).toHaveLength(2)
    expect(conditional[1]!.aborted).toBe(false)
    expect(screen.getByLabelText('Email')).toBeTruthy()
  })

  it('waits in the field again after a passkey from it was refused for another account’s progress', async () => {
    passkeyBrowser({ conditional: true })
    const ctx = await setup()
    let first = true
    const conditional: AbortSignal[] = []
    const api = fakeApi({
      passkeySignIn: ({ signal }) => {
        if (signal) conditional.push(signal)
        if (first) {
          first = false
          return Promise.resolve()
        }
        return new Promise<void>((_, reject) => signal?.addEventListener('abort', () => reject(new PasskeyCancelled())))
      },
    })
    const accounts = fakeAccounts({ completeSignIn: async () => 'other-account' })
    renderWith(<SignIn deviceStore={device} />, { ...ctx, api, accounts, account: ANA })
    await act(async () => undefined)
    expect(screen.getByRole('alert').textContent).toContain('This device holds the progress of ana@example.com')
    expect(conditional).toHaveLength(2)
    expect(conditional[1]!.aborted).toBe(false)
  })
})

describe('SignIn: passkeys in the email field’s autofill (#287)', () => {
  /** A passkey request that waits until it is aborted, as a conditional one does; logs whether it was aborted when the next call came. */
  function waitingApi() {
    let signal: AbortSignal | undefined
    const log: string[] = []
    const api = fakeApi({
      passkeySignIn: ({ conditional, signal: s }) => {
        if (!conditional) {
          log.push(`button, autofill aborted ${signal?.aborted}`)
          return Promise.resolve()
        }
        signal = s
        log.push('conditional')
        return new Promise<void>((_, reject) => s?.addEventListener('abort', () => reject(new PasskeyCancelled())))
      },
      sendCode: async () => {
        log.push(`sendCode, autofill aborted ${signal?.aborted}`)
      },
    })
    return { api, log }
  }

  async function renderWaiting() {
    const ctx = await setup()
    const { api, log } = waitingApi()
    const accounts = fakeAccounts()
    renderWith(<SignIn deviceStore={device} />, { ...ctx, api, accounts })
    await act(async () => undefined)
    return { log, accounts }
  }

  it('lists passkeys in the email field and waits for one, where the browser can', async () => {
    passkeyBrowser({ conditional: true })
    const { log } = await renderWaiting()
    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('email webauthn')
    expect(log).toEqual(['conditional'])
  })

  it('does not wait in the field where the browser cannot list passkeys there', async () => {
    passkeyBrowser({ conditional: false })
    const { log } = await renderWaiting()
    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('email')
    expect(log).toEqual([])
  })

  it('stops waiting before the passkey button asks, and says nothing of it', async () => {
    passkeyBrowser({ conditional: true })
    const { log, accounts } = await renderWaiting()
    await pressPasskey()
    expect(log).toEqual(['conditional', 'button, autofill aborted true'])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(accounts.calls).toEqual(['completeSignIn'])
  })

  it('stops waiting before a code is sent, and says nothing of it', async () => {
    passkeyBrowser({ conditional: true })
    const { log } = await renderWaiting()
    await enterEmail()
    expect(log).toEqual(['conditional', 'sendCode, autofill aborted true'])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Code')).toBeTruthy()
  })

  it.each([
    ['a removed passkey', new ApiError(401, 'PASSKEY_NOT_FOUND'), 'This passkey no longer works. Sign in with a code, then you can add a new one.'],
    ['a refused check', new ApiError(400, 'AUTHENTICATION_FAILED'), 'Something went wrong. Try again.'],
    ['no device unlock', new ApiError(401, 'USER_NOT_VERIFIED'), 'Something went wrong. Try again.'],
    ['a cancelled prompt', new PasskeyCancelled(), null],
    ['options the server could not give', new ApiError(404, null), null],
    ['too many requests', new ApiError(429, null), null],
    ['no connection', new OfflineError(new TypeError('Failed to fetch')), null],
  ])('after %s in the field, says only what concerns a passkey the learner picked', async (_, error, message) => {
    passkeyBrowser({ conditional: true })
    const { accounts } = await render({}, { passkeySignIn: async () => Promise.reject(error) })
    if (message === null) expect(screen.queryByRole('alert')).toBeNull()
    else expect(screen.getByRole('alert').textContent).toBe(message)
    expect(accounts.calls).toEqual([])
  })

  it('signs in with a passkey picked from the field, with no offer', async () => {
    passkeyBrowser({ conditional: true, platform: true })
    const { api, accounts } = await render()
    expect(api.calls).toContain('passkeySignIn conditional')
    expect(accounts.calls).toEqual(['completeSignIn'])
    expect(offerPending.get()).toBe(false)
    expect(window.location.pathname).toBe('/')
  })
})

describe('SignIn: the offer of a passkey after a code (#287)', () => {
  /** Finishing a sign-in switches the database, which mounts the app afresh: a new sign-in screen, the account now there. */
  async function remountSignedIn(apiOver: Parameters<typeof fakeApi>[0] = {}) {
    cleanup()
    const ctx = await setup()
    const api = fakeApi(apiOver)
    const accounts = fakeAccounts()
    renderWith(<SignIn deviceStore={device} />, { ...ctx, api, accounts, account: ANA })
    await act(async () => undefined)
    return { api, accounts }
  }

  /** A code sign-in that leaves the offer owed, then the screen the switch mounts. */
  async function reachOffer(apiOver: Parameters<typeof fakeApi>[0] = {}) {
    passkeyBrowser({ platform: true })
    await render()
    await enterEmail()
    await enterCode()
    expect(offerPending.get()).toBe(true)
    expect(window.location.pathname).toBe('/signin')
    return remountSignedIn(apiOver)
  }

  it('shows the offer on the screen mounted after the switch, its heading focused', async () => {
    await reachOffer()
    const heading = screen.getByRole('heading', { name: OFFER })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByText('Your device’s fingerprint, face or PIN signs you in instead of a code. Nothing about your face or finger leaves the device.')).toBeTruthy()
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('keeps focus on the offer when the shell mounted by the switch arrives (resumed), however the timing falls', async () => {
    passkeyBrowser({ platform: true })
    offerPending.set(true)
    const ctx = await setup()
    renderWith(<App resumed setup={false} onFinishSetup={() => undefined} />, { ...ctx, api: fakeApi(), accounts: fakeAccounts(), account: ANA })
    await act(async () => undefined)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: OFFER }))
  })

  it('leaves the shell’s arrival as it was on the first step: the screen itself, not its heading', async () => {
    passkeyBrowser({ platform: true })
    const ctx = await setup()
    renderWith(<App resumed setup={false} onFinishSetup={() => undefined} />, { ...ctx, api: fakeApi(), accounts: fakeAccounts(), account: ANA })
    await act(async () => undefined)
    expect(document.activeElement?.tagName).toBe('MAIN')
  })

  it('shows the offer on the same screen when the sign-in switched nothing (an expired sign-in)', async () => {
    passkeyBrowser({ platform: true })
    const ctx = await setup()
    renderWith(<SignIn deviceStore={device} />, { ...ctx, api: fakeApi(), accounts: fakeAccounts(), account: ANA })
    await act(async () => undefined)
    await enterEmail()
    await enterCode()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: OFFER }))
  })

  it('shows the method step, as before, to a screen mounted with no offer owed', async () => {
    passkeyBrowser({ platform: true })
    await remountSignedIn()
    expect(screen.queryByRole('heading', { name: OFFER })).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'How do you want to sign in?' })).toBeTruthy()
  })

  it('adds a passkey, says so, and goes home', async () => {
    const { api } = await reachOffer()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use a passkey' })))
    expect(api.calls).toContain('passkeyRegister')
    expect(screen.getByRole('status').textContent).toBe('Passkey added. Next time, sign in with it.')
    expect(offerAnswered(device)).toBe(true)
    expect(window.location.pathname).toBe('/signin')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    expect(window.location.pathname).toBe('/')
    expect(offerPending.get()).toBe(false)
  })

  it('goes home at once on "Not now", and the device has answered', async () => {
    const { api } = await reachOffer()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Not now' })))
    expect(api.calls).not.toContain('passkeyRegister')
    expect(offerAnswered(device)).toBe(true)
    expect(offerPending.get()).toBe(false)
    expect(window.location.pathname).toBe('/')
  })

  it.each([
    ['cancels the device prompt', new PasskeyCancelled()],
    ['fails', new ApiError(400, 'FAILED_TO_VERIFY_REGISTRATION')],
  ])('says in one line when the learner %s, and goes on', async (_, error) => {
    await reachOffer({ passkeyRegister: async () => Promise.reject(error) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use a passkey' })))
    expect(screen.getByRole('status').textContent).toBe('The passkey was not added. You can add one in settings.')
    expect(offerAnswered(device)).toBe(true)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    expect(window.location.pathname).toBe('/')
  })

  it('offers once per device: a second code sign-in goes straight home', async () => {
    await reachOffer()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Not now' })))
    cleanup()
    window.history.replaceState(null, '', '/signin')
    await render()
    await enterEmail()
    await enterCode()
    expect(offerPending.get()).toBe(false)
    expect(window.location.pathname).toBe('/')
  })

  it('starts completing the sign-in without waiting for the platform check', async () => {
    let release: (v: boolean) => void = () => {}
    vi.stubGlobal('PublicKeyCredential', {
      isUserVerifyingPlatformAuthenticatorAvailable: () => new Promise<boolean>((r) => (release = r)),
      isConditionalMediationAvailable: async () => false,
    })
    const { accounts } = await render()
    await enterEmail()
    await enterCode()
    expect(accounts.calls).toEqual(['completeSignIn'])
    expect(offerPending.get()).toBe(false)
    await act(async () => release(true))
    expect(offerPending.get()).toBe(true)
  })

  it('offers nothing on a device without its own unlock', async () => {
    passkeyBrowser({ platform: false })
    await render()
    await enterEmail()
    await enterCode()
    expect(offerPending.get()).toBe(false)
    expect(window.location.pathname).toBe('/')
  })

  it('offers it after the age step of a new account too', async () => {
    passkeyBrowser({ platform: true })
    await render({}, {}, NEW)
    await reachGate()
    await passGate('BG')
    expect(offerPending.get()).toBe(true)
  })

  it.each([
    ['refused for another account’s progress', async () => 'other-account' as const],
    ['failed', async () => Promise.reject(new OfflineError(new TypeError('Failed to fetch')))],
  ])('owes no offer when completing the sign-in was %s', async (_, completeSignIn) => {
    passkeyBrowser({ platform: true })
    await render({ completeSignIn })
    await enterEmail()
    await enterCode()
    expect(offerPending.get()).toBe(false)
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
