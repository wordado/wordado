import { describe, expect, it } from 'vitest'
import { consoleMailer, resendMailer } from './mail'

describe('consoleMailer', () => {
  it('prints the code on the line the smoke script reads', async () => {
    const lines: string[] = []
    await consoleMailer((line) => lines.push(line)).sendSignInCode('ana@example.com', '123456')
    expect(lines).toEqual(['Sign-in code for ana@example.com: 123456'])
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

  it('throws when Resend refuses', async () => {
    const mailer = resendMailer({ apiKey: 're_test', from: 'x@wordado.com', fetch: async () => new Response('no', { status: 422 }) })
    await expect(mailer.sendSignInCode('ana@example.com', '123456')).rejects.toThrow('422')
  })
})
