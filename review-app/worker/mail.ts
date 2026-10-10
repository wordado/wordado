import { FEEDBACK_KINDS, type FeedbackKind } from '@wordado/core'
import { LANGUAGE_NAMES, type Language } from '../shared/hosted'
import type { Deps } from './app'

/** What the weekly mail says (spec 2026-10-10 §3.4): numbers and a link. It has no field a learner's words could travel in. */
export interface WeekMail {
  /** The first and the last day of the week, as UTC dates: "2026-10-05", "2026-10-11". */
  readonly from: string
  readonly to: string
  readonly total: number
  /** The count stopped at the cap: there are more. */
  readonly more: boolean
  readonly byKind: Readonly<Record<FeedbackKind, number>>
}

/** The mail service did not take a mail: `message` holds its status and nothing of the mail. */
export class MailRefused extends Error {}

export interface ReviewMailer {
  invite(to: string, name: string, languages: readonly Language[]): Promise<void>
  submitted(to: readonly string[], s: { name: string; count: number; queue: string; url: string }): Promise<void>
  /** Sends nothing when there is nobody to tell or nothing to say. */
  weekly(to: readonly string[], week: WeekMail): Promise<void>
}

/** The learner's own kinds, as the feedback form names them. */
const KIND_LINE: Readonly<Record<FeedbackKind, string>> = { bug: "Something isn't working", idea: 'An idea', other: 'Something else' }

const list = (langs: readonly Language[]) => {
  const names = langs.map((l) => LANGUAGE_NAMES[l])
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`
}

/** Invites, submit notices and the weekly feedback mail (spec §8) through Resend's HTTP API; without a key (local, tests), log lines. */
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
    if (!res.ok) throw new MailRefused(`Resend refused the email: ${res.status}`)
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
    weekly: (to, week) => {
      if (to.length === 0 || week.total === 0) return Promise.resolve()
      const count = week.total.toLocaleString('en-US')
      const messages = `${week.more ? 'more than ' : ''}${count} ${week.total === 1 && !week.more ? 'message' : 'messages'}`
      const kinds = FEEDBACK_KINDS.map((kind) => `${KIND_LINE[kind]}: ${week.byKind[kind].toLocaleString('en-US')}`).join('\n')
      return send(
        to,
        `Wordado feedback: ${messages} this week`,
        `${messages.charAt(0).toUpperCase()}${messages.slice(1)} came from learners between ${week.from} and ${week.to}.\n\n${week.more ? `Of the ${count} counted:\n` : ''}${kinds}\n\nRead ${week.total === 1 && !week.more ? 'it' : 'them'}: ${env.APP_ORIGIN}/#feedback`,
      )
    },
  }
}
