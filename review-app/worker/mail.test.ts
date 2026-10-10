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

  describe('the weekly feedback mail (spec 2026-10-10 §3.4)', () => {
    const week = { from: '2026-10-05', to: '2026-10-11', total: 7, more: false, byKind: { bug: 3, idea: 2, other: 2 } }
    const sending = () => {
      const calls: { url: string; body: Record<string, unknown> }[] = []
      const lines: string[] = []
      const mailer = reviewMailer({ env, fetch: async (url: string, init?: RequestInit) => (calls.push({ url, body: JSON.parse(String(init?.body)) }), new Response('{}')), now: () => new Date(), log: (l: string) => lines.push(l) } as never)
      return { calls, lines, mailer }
    }

    it('says how many messages came, by kind, and where to read them', async () => {
      const { calls, mailer } = sending()
      await mailer.weekly(['admin@example.com', 'second@example.com'], week)
      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toBe('https://api.resend.com/emails')
      expect(calls[0]!.body).toEqual({
        from: env.MAIL_FROM,
        to: ['admin@example.com', 'second@example.com'],
        subject: 'Wordado feedback: 7 messages this week',
        text: '7 messages came from learners between 2026-10-05 and 2026-10-11.\n\nSomething isn\'t working: 3\nAn idea: 2\nSomething else: 2\n\nRead them: https://review.wordado.com/#feedback',
      })
    })

    it('says "1 message", and keeps the line of a kind with none', async () => {
      const { calls, mailer } = sending()
      await mailer.weekly(['admin@example.com'], { ...week, total: 1, byKind: { bug: 0, idea: 1, other: 0 } })
      expect(calls[0]!.body['subject']).toBe('Wordado feedback: 1 message this week')
      expect(calls[0]!.body['text']).toBe('1 message came from learners between 2026-10-05 and 2026-10-11.\n\nSomething isn\'t working: 0\nAn idea: 1\nSomething else: 0\n\nRead it: https://review.wordado.com/#feedback')
    })

    it('says "more than" when the count stopped at the cap, and that the kinds are of those counted', async () => {
      const { calls, mailer } = sending()
      await mailer.weekly(['admin@example.com'], { ...week, total: 1000, more: true, byKind: { bug: 600, idea: 300, other: 100 } })
      expect(calls[0]!.body['subject']).toBe('Wordado feedback: more than 1,000 messages this week')
      expect(calls[0]!.body['text']).toBe(
        'More than 1,000 messages came from learners between 2026-10-05 and 2026-10-11.\n\nOf the 1,000 counted:\nSomething isn\'t working: 600\nAn idea: 300\nSomething else: 100\n\nRead them: https://review.wordado.com/#feedback',
      )
    })

    it('sends nothing to nobody, and nothing about a week with no feedback', async () => {
      const { calls, lines, mailer } = sending()
      await mailer.weekly([], week)
      await mailer.weekly(['admin@example.com'], { ...week, total: 0, byKind: { bug: 0, idea: 0, other: 0 } })
      expect(calls).toEqual([])
      expect(lines).toEqual([])
    })

    it('logs one line instead without a key', async () => {
      const lines: string[] = []
      const logging = reviewMailer({ env: { ...env, RESEND_API_KEY: undefined }, fetch: async () => new Response('no', { status: 500 }), now: () => new Date(), log: (l: string) => lines.push(l) } as never)
      await logging.weekly(['admin@example.com'], week)
      expect(lines).toEqual(['mail to admin@example.com: Wordado feedback: 7 messages this week'])
    })

    it('throws when Resend refuses', async () => {
      const refusing = reviewMailer({ env, fetch: async () => new Response('no', { status: 422 }), now: () => new Date(), log: () => undefined } as never)
      await expect(refusing.weekly(['admin@example.com'], week)).rejects.toThrow(/422/)
    })
  })
})
