import { describe, expect, it } from 'vitest'
import type { AnnouncementMail } from './deps'
import { consoleMailer, MailNotSent, resendMailer } from './mail'

const news: AnnouncementMail = {
  to: 'ana@example.com',
  subject: 'New: search',
  text: 'Hello.\n\n-- \nWhy.',
  headers: { 'List-Unsubscribe': '<https://app.wordado.com/v1/news/unsubscribe?t=a.b&l=en>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  replyTo: 'privacy@wordado.com',
  idempotencyKey: 'announcement/7/0b0e7d0e-5c0f-4d2e-9d67-3f1f0a8d2c11',
}

describe('consoleMailer', () => {
  it('prints the code on the line the smoke script reads', async () => {
    const lines: string[] = []
    await consoleMailer((line) => lines.push(line)).sendSignInCode('ana@example.com', '123456')
    expect(lines).toEqual(['Sign-in code for ana@example.com: 123456'])
  })

  it('prints that an announcement mail was made, without the address it was for (#185)', async () => {
    const lines: string[] = []
    await consoleMailer((line) => lines.push(line)).sendAnnouncement(news)
    expect(lines).toEqual(['Announcement mail: New: search'])
  })

})

describe('resendMailer', () => {
  it('sends the code and nothing else through the Resend API (spec §11)', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const mailer = resendMailer({
      apiKey: 're_test',
      from: 'Wordado <codes@wordado.com>',
      fetch: async (url, init) => {
        calls.push({ url, init })
        return new Response('{}', { status: 200 })
      },
    })
    await mailer.sendSignInCode('ana@example.com', '123456')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.resend.com/emails')
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer re_test')
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body).toEqual({
      from: 'Wordado <codes@wordado.com>',
      to: ['ana@example.com'],
      subject: 'Wordado: 123456',
      text: expect.stringContaining('123456'),
    })
  })

  it('sends the code in every interface language, including German and Spanish (plans 10, 12)', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const mailer = resendMailer({
      apiKey: 're_test',
      from: 'Wordado <codes@wordado.com>',
      fetch: async (url, init) => {
        calls.push({ url, init })
        return new Response('{}', { status: 200 })
      },
    })
    await mailer.sendSignInCode('ana@example.com', '123456')
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.text).toContain('Your Wordado sign-in code is 123456. It expires in 5 minutes.')
    expect(body.text).toContain('Вашият код за вход в Wordado е 123456. Валиден е 5 минути.')
    expect(body.text).toContain('Dein Wordado-Anmeldecode ist 123456. Er ist 5 Minuten gültig.')
    expect(body.text).toContain('Tu código de inicio de sesión en Wordado es 123456. Caduca en 5 minutos.')
  })

  it('throws when Resend refuses', async () => {
    const mailer = resendMailer({ apiKey: 're_test', from: 'x@wordado.com', fetch: async () => new Response('no', { status: 422 }) })
    await expect(mailer.sendSignInCode('ana@example.com', '123456')).rejects.toThrow('422')
  })

  it('sends an announcement as plain text with its headers, an address for answers, and a key that makes it one mail (#185)', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const mailer = resendMailer({
      apiKey: 're_test',
      from: 'Wordado <codes@wordado.com>',
      fetch: async (url, init) => {
        calls.push({ url, init })
        return new Response('{}', { status: 200 })
      },
    })
    await mailer.sendAnnouncement(news)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.resend.com/emails')
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get('authorization')).toBe('Bearer re_test')
    expect(headers.get('idempotency-key')).toBe(news.idempotencyKey)
    // No `html`: what was written cannot be markup.
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: 'Wordado <codes@wordado.com>',
      to: ['ana@example.com'],
      reply_to: 'privacy@wordado.com',
      subject: 'New: search',
      text: news.text,
      headers: news.headers,
    })
  })

  it('tells a mail the provider will never take from one it does not take now, and from an allowance used up (#185)', async () => {
    const answering = (status: number, body = '{}') => resendMailer({ apiKey: 're_test', from: 'x@wordado.com', fetch: async () => new Response(body, { status }) })
    const reason = async (status: number, body?: string) => {
      const error = await answering(status, body).sendAnnouncement(news).then(() => null, (e: unknown) => e)
      expect(error).toBeInstanceOf(MailNotSent)
      expect((error as MailNotSent).message).not.toContain('ana@example.com')
      return (error as MailNotSent).reason
    }
    expect(await reason(422)).toBe('refused')
    expect(await reason(429, JSON.stringify({ statusCode: 429, name: 'daily_quota_exceeded', message: 'You have reached your daily email sending quota.' }))).toBe('quota')
    expect(await reason(429, JSON.stringify({ statusCode: 429, name: 'monthly_quota_exceeded', message: 'x' }))).toBe('quota')
    expect(await reason(429, JSON.stringify({ statusCode: 429, name: 'rate_limit_exceeded', message: 'x' }))).toBe('busy')
    expect(await reason(429, 'not json')).toBe('busy')
    // A key or a domain the provider does not accept is nothing of the recipient's: the mail waits.
    for (const status of [401, 403, 500, 503]) expect(await reason(status)).toBe('busy')
  })

  it('leaves a request that got no answer as it is: whether the mail went is not known (#185)', async () => {
    const mailer = resendMailer({
      apiKey: 're_test',
      from: 'x@wordado.com',
      fetch: async () => {
        throw new TypeError('network')
      },
    })
    const error = await mailer.sendAnnouncement(news).then(() => null, (e: unknown) => e)
    expect(error).toBeInstanceOf(TypeError)
    expect(error).not.toBeInstanceOf(MailNotSent)
    // Asked again with a key in use, the provider says so: still not known.
    const conflict = await resendMailer({ apiKey: 're_test', from: 'x@wordado.com', fetch: async () => new Response('{}', { status: 409 }) })
      .sendAnnouncement(news)
      .then(() => null, (e: unknown) => e)
    expect(conflict).toBeInstanceOf(Error)
    expect(conflict).not.toBeInstanceOf(MailNotSent)
  })
})
