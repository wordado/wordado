import { FEEDBACK_KINDS, type FeedbackKind } from '@wordado/core'
import { FEEDBACK_CATEGORIES, LANGUAGE_NAMES, type FeedbackCategory, type Language } from '../shared/hosted'
import type { Deps } from './app'

/** What the AI read of the week, for the mail: numbers, the titles of topics and its paragraph about them, which is
 * written from those numbers and titles alone. A title and the paragraph are the only free text, and both were held
 * to hold no address, link or phone number before they were kept (topicTitle.ts, feedbackWeek.ts). */
export interface WeekMailAi {
  /** Messages of the week the AI has read. */
  readonly read: number
  readonly byCategory: Readonly<Record<FeedbackCategory, number>>
  readonly topTopics: readonly { readonly title: string; readonly count: number }[]
  readonly blockingBugs: number
  readonly newTopics: readonly string[]
  readonly paragraph: string | null
}

/** What the weekly mail says (spec 2026-10-10 §3.4): numbers and a link, and with the AI help, what the AI read of
 * the week. It has no field a learner's words could travel in. */
export interface WeekMail {
  /** The first and the last day of the week, as UTC dates: "2026-10-05", "2026-10-11". */
  readonly from: string
  readonly to: string
  readonly total: number
  /** The count stopped at the cap: there are more. */
  readonly more: boolean
  readonly byKind: Readonly<Record<FeedbackKind, number>>
  /** Left out, or with nothing read, the mail is the one it is without the AI help. */
  readonly ai?: WeekMailAi
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

/** The AI's categories, as the tab names them. */
const CATEGORY_LINE: Readonly<Record<FeedbackCategory, string>> = { bug: 'Bug', idea: 'Idea', question: 'Question', praise: 'Praise', junk: 'Junk' }

/** The AI's part of the weekly mail, in blocks with an empty line between: its paragraph, named as its own, then
 * how many messages it read and what it took them for, the topics with the most messages, the bugs that block,
 * and the new topics. */
function aiBlocks(ai: WeekMailAi, of: string): string[] {
  const n = (count: number) => count.toLocaleString('en-US')
  return [
    ...(ai.paragraph !== null ? [`Written by the AI: ${ai.paragraph}`] : []),
    [`Read by the AI: ${n(ai.read)} of ${of}`, ...FEEDBACK_CATEGORIES.map((category) => `${CATEGORY_LINE[category]}: ${n(ai.byCategory[category])}`)].join('\n'),
    ...(ai.topTopics.length > 0 ? [['Most messages:', ...ai.topTopics.map((t) => `- ${t.title}: ${n(t.count)}`)].join('\n')] : []),
    `Bugs that block learners: ${n(ai.blockingBugs)}`,
    ...(ai.newTopics.length > 0 ? [['New topics:', ...ai.newTopics.map((title) => `- ${title}`)].join('\n')] : []),
  ]
}

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
      // The AI's part stands between the counts and the link; without it the mail is the one it always was.
      const ai = week.ai && week.ai.read > 0 ? aiBlocks(week.ai, `${week.more ? 'more than ' : ''}${count}`) : []
      const blocks = [
        `${messages.charAt(0).toUpperCase()}${messages.slice(1)} came from learners between ${week.from} and ${week.to}.`,
        `${week.more ? `Of the ${count} counted:\n` : ''}${kinds}`,
        ...ai,
        `Read ${week.total === 1 && !week.more ? 'it' : 'them'}: ${env.APP_ORIGIN}/#feedback`,
      ]
      return send(to, `Wordado feedback: ${messages} this week`, blocks.join('\n\n'))
    },
  }
}
