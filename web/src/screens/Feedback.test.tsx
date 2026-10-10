import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, OfflineError, type Api } from '../account/api'
import { fakeApi } from '../test/fakeApi'
import { renderWith, setup } from '../test/fixtures'
import { Feedback } from './Feedback'

beforeEach(() => window.history.replaceState(null, '', '/feedback?from=%2Fpath'))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function render(over: Partial<Api> = {}, options: { readonly account?: { userId: string; email: string }; readonly locale?: 'bg' | 'de' | 'es' } = {}) {
  const ctx = await setup()
  const api = fakeApi(over)
  renderWith(<Feedback from="/path" version="B3kq9xZa" />, { ...ctx, api, ...(options.account ? { account: options.account } : {}), ...(options.locale ? { locale: options.locale } : {}) })
  return { ...ctx, api }
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const send = () => act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })))

describe('Feedback (spec §8.12)', () => {
  it('asks for a kind, a message and an optional address, the address left empty even when signed in', async () => {
    await render({}, { account: { userId: 'u1', email: 'ana@example.com' } })
    expect(screen.getByRole('heading', { level: 1, name: 'Send feedback' })).toBeTruthy()
    const kinds = within(screen.getByRole('group', { name: 'What is it about?' })).getAllByRole('radio') as HTMLInputElement[]
    expect(kinds.map((radio) => radio.value)).toEqual(['bug', 'idea', 'other'])
    expect(kinds.map((radio) => radio.checked)).toEqual([true, false, false])
    expect(screen.getByRole('radio', { name: 'Something isn’t working' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'I have an idea' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Something else' })).toBeTruthy()
    const message = screen.getByLabelText('Your message') as HTMLTextAreaElement
    expect(message.maxLength).toBe(2000)
    expect(message.required).toBe(true)
    const email = screen.getByLabelText('Email, if you’d like an answer (optional)') as HTMLInputElement
    expect(email.value).toBe('')
    expect(email.maxLength).toBe(254)
  })

  it('asks under the message for no personal details, on the form only', async () => {
    await render()
    const line = screen.getByText('Please don’t write personal details about yourself or other people.')
    expect(line.tagName).toBe('P')
    const message = screen.getByLabelText('Your message')
    // The line describes the field, so a screen reader says it with the label.
    expect(message.getAttribute('aria-describedby')).toBe(line.id)
    expect(message.nextElementSibling).toBe(line)
    type('Your message', 'Hello.')
    await send()
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByText('Please don’t write personal details about yourself or other people.')).toBeNull()
  })

  it('lists everything that is sent with the message, the account only when signed in', async () => {
    const { client } = await render()
    const { packVersion, l1 } = client.store.get()
    const items = within(screen.getByRole('list', { name: 'Sent with your message' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(items).toEqual([
      'App version: B3kq9xZa',
      `Word list version: ${l1}-${packVersion}`,
      'Interface language: English (en)',
      'Opened from: /path',
      `Browser: ${navigator.userAgent}`,
    ])
    cleanup()
    await render({}, { account: { userId: 'u1', email: 'ana@example.com' } })
    expect(within(screen.getByRole('list', { name: 'Sent with your message' })).getAllByRole('listitem')[0]!.textContent).toBe('Your account: ana@example.com')
  })

  it('sends what was typed with exactly the details it listed, then thanks the learner and offers the way back', async () => {
    const { api, client } = await render()
    const { packVersion, l1 } = client.store.get()
    fireEvent.click(screen.getByRole('radio', { name: 'I have an idea' }))
    type('Your message', '  A dark theme, please. ')
    type('Email, if you’d like an answer (optional)', ' ana@example.com ')
    await send()
    expect(api.feedback).toEqual([
      {
        kind: 'idea',
        message: 'A dark theme, please.',
        email: 'ana@example.com',
        appVersion: 'B3kq9xZa',
        corpusVersion: `${l1}-${packVersion}`,
        language: 'en',
        screen: '/path',
        userAgent: navigator.userAgent,
        website: '',
      },
    ])
    const thanks = screen.getByRole('status')
    expect(thanks.textContent).toBe('Thank you! We’ve got your message.')
    expect(document.activeElement).toBe(thanks)
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/path')
    expect(screen.queryByLabelText('Your message')).toBeNull()
  })

  it('shows the progress bar and holds the button while sending, and sends once', async () => {
    let finish: () => void = () => undefined
    const { api } = await render({ sendFeedback: () => new Promise<void>((resolve) => (finish = resolve)) })
    const spy = vi.spyOn(api, 'sendFeedback')
    type('Your message', 'Hello.')
    const button = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    await act(async () => fireEvent.click(button))
    expect(screen.getByRole('progressbar', { name: 'Sending…' })).toBeTruthy()
    expect(button.disabled).toBe(true)
    await act(async () => fireEvent.submit(button.closest('form')!))
    expect(spy).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Thank you! We’ve got your message.')
  })

  it('asks for a message before sending, and for an address that looks like one', async () => {
    const { api } = await render()
    type('Your message', '   ')
    type('Email, if you’d like an answer (optional)', 'ana.example.com')
    await send()
    expect(api.calls).toEqual([])
    const message = screen.getByLabelText('Your message')
    expect(message.getAttribute('aria-invalid')).toBe('true')
    // The field is described by the line about personal details first, then by what is wrong.
    expect(message.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)!.textContent)).toEqual([
      'Please don’t write personal details about yourself or other people.',
      'Write your message first.',
    ])
    const email = screen.getByLabelText('Email, if you’d like an answer (optional)')
    expect(document.getElementById(email.getAttribute('aria-describedby')!)!.textContent).toBe('Enter an email address, like name@example.com.')
    type('Your message', 'Hello.')
    type('Email, if you’d like an answer (optional)', '')
    await send()
    expect(api.calls).toEqual(['sendFeedback'])
  })

  it('keeps the text and says why when the server refuses or fails', async () => {
    for (const [error, text] of [
      [new ApiError(429, 'feedback_limit'), 'Too many tries. Wait a moment and try again.'],
      [new ApiError(500, 'internal'), 'Wordado isn’t answering properly right now. Try again later.'],
      [new ApiError(400, 'invalid'), 'Something went wrong. Try again.'],
    ] as const) {
      await render({
        sendFeedback: async () => {
          throw error
        },
      })
      type('Your message', 'The path does not open.')
      type('Email, if you’d like an answer (optional)', 'ana@example.com')
      await send()
      expect(screen.getByRole('alert').textContent).toBe(text)
      expect((screen.getByLabelText('Your message') as HTMLTextAreaElement).value).toBe('The path does not open.')
      expect((screen.getByLabelText('Email, if you’d like an answer (optional)') as HTMLInputElement).value).toBe('ana@example.com')
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false)
      cleanup()
    }
  })

  it('says sending needs a connection when there is none, keeps the text, and sends it on the next try', async () => {
    let offline = true
    const { api } = await render({
      sendFeedback: async () => {
        if (offline) throw new OfflineError(new TypeError('Failed to fetch'))
        api.calls.push('sendFeedback')
      },
    })
    type('Your message', 'The path does not open.')
    await send()
    expect(screen.getByRole('alert').textContent).toBe('Sending needs a connection. Your message stays here: send it when you’re back online.')
    expect((screen.getByLabelText('Your message') as HTMLTextAreaElement).value).toBe('The path does not open.')
    offline = false
    await send()
    expect(api.calls).toEqual(['sendFeedback'])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Thank you! We’ve got your message.')
  })

  it('says so beforehand when the browser knows it is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await render()
    expect(screen.getByText('Sending needs a connection. Your message stays here: send it when you’re back online.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('hides a field no person fills in, and sends what a program put there', async () => {
    const { api } = await render()
    const trap = document.querySelector('input[name="website"]') as HTMLInputElement
    expect(trap.tabIndex).toBe(-1)
    expect(trap.autocomplete).toBe('off')
    expect(trap.closest('[aria-hidden="true"]')?.className).toBe('visually-hidden')
    expect(screen.queryByRole('textbox', { name: 'Website' })).toBeNull()
    fireEvent.change(trap, { target: { value: 'https://example.com' } })
    type('Your message', 'Buy now.')
    await send()
    expect(api.feedback[0]!.website).toBe('https://example.com')
  })

  it('is in Bulgarian, German and Spanish too', async () => {
    await render({}, { locale: 'bg' })
    expect(screen.getByRole('heading', { level: 1, name: 'Изпратете обратна връзка' })).toBeTruthy()
    expect(screen.getAllByRole('radio').map((radio) => radio.closest('label')!.textContent)).toEqual(['Нещо не работи', 'Имам идея', 'Нещо друго'])
    expect(screen.getByLabelText('Вашето съобщение')).toBeTruthy()
    expect(screen.getByLabelText('Имейл, ако искате отговор (по желание)')).toBeTruthy()
    expect(screen.getByText('Моля, не пишете лични данни за себе си или за други хора.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Вашето съобщение'), { target: { value: 'Здравейте.' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Изпратете' })))
    expect(screen.getByRole('status').textContent).toBe('Благодарим! Получихме съобщението ви.')
    cleanup()
    await render({}, { locale: 'de' })
    expect(screen.getByRole('button', { name: 'Senden' })).toBeTruthy()
    expect(screen.getByText('Bitte schreib keine persönlichen Daten über dich oder andere Personen.')).toBeTruthy()
    cleanup()
    await render({}, { locale: 'es' })
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeTruthy()
    expect(screen.getByText('Por favor, no escribas datos personales tuyos ni de otras personas.')).toBeTruthy()
  })
})
