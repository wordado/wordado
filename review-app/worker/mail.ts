import { LANGUAGE_NAMES, type Language } from '../shared/hosted'
import type { Deps } from './app'

export interface ReviewMailer {
  invite(to: string, name: string, languages: readonly Language[]): Promise<void>
  submitted(to: readonly string[], s: { name: string; count: number; queue: string; url: string }): Promise<void>
}

const list = (langs: readonly Language[]) => {
  const names = langs.map((l) => LANGUAGE_NAMES[l])
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`
}

/** Invites and submit notices (spec §8) through Resend's HTTP API; without a key (local, tests), log lines. */
export function reviewMailer(deps: Pick<Deps, 'env' | 'fetch' | 'log'>): ReviewMailer {
  const { env } = deps
  const send = async (to: readonly string[], subject: string, text: string) => {
    if (!env.RESEND_API_KEY) {
      deps.log(`mail to ${to.join(', ')}: ${subject}`)
      return
    }
    const res = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to, subject, text }),
    })
    if (!res.ok) throw new Error(`Resend refused the email: ${res.status}`)
  }
  return {
    invite: (to, name, languages) =>
      send(
        [to],
        `You are invited to review ${list(languages)} for Wordado`,
        `Hello ${name},\n\nYou are invited to review ${list(languages)} for Wordado, an app that teaches English vocabulary.\n\nOpen ${env.APP_ORIGIN} and sign in with this address (${to}): you will get a code by email.\n\nThe coordinator will tell you which rows are yours.`,
      ),
    submitted: (to, s) =>
      to.length === 0 ? Promise.resolve() : send(to, `${s.name} submitted ${s.count} decisions on ${s.queue}`, `${s.name} submitted ${s.count} decisions on ${s.queue}.\n\nPull request: ${s.url}`),
  }
}
