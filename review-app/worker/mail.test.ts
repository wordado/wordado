import { describe, expect, it } from 'vitest'
import { reviewMailer } from './mail'

const env = { MAIL_FROM: 'Wordado Review <review@wordado.com>', APP_ORIGIN: 'https://review.wordado.com', RESEND_API_KEY: 're_test' }

describe('reviewMailer', () => {
  it('sends an invite through Resend with the link and the sign-in line', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    const mailer = reviewMailer({ env, fetch: async (url: string, init?: RequestInit) => (calls.push({ url, body: JSON.parse(String(init?.body)) }), new Response('{}')), now: () => new Date(), log: () => undefined } as never)
    await mailer.invite('anna@example.com', 'Anna', ['de'])
    expect(calls[0]!.url).toBe('https://api.resend.com/emails')
    expect(calls[0]!.body).toMatchObject({ from: env.MAIL_FROM, to: ['anna@example.com'], subject: 'You are invited to review German for Wordado' })
    expect(String(calls[0]!.body['text'])).toContain('https://review.wordado.com')
    expect(String(calls[0]!.body['text'])).toMatch(/code/)
  })
  it('throws when Resend refuses, and logs instead without a key', async () => {
    const refusing = reviewMailer({ env, fetch: async () => new Response('no', { status: 422 }), now: () => new Date(), log: () => undefined } as never)
    await expect(refusing.invite('a@example.com', 'A', ['bg'])).rejects.toThrow(/422/)
    const lines: string[] = []
    const logging = reviewMailer({ env: { ...env, RESEND_API_KEY: undefined }, fetch: async () => new Response(), now: () => new Date(), log: (l: string) => lines.push(l) } as never)
    await logging.submitted(['admin@example.com'], { name: 'Anna', count: 3, queue: 'translation-de', url: 'https://github.com/x/pull/1' })
    expect(lines[0]).toMatch(/admin@example.com/)
  })
})
