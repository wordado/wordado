import { utcDay, type FeedbackKind } from '@wordado/core'
import type { ServerDeps } from '../deps'

/** The most messages one mail lists; the rest are counted in its last line and come the next day. */
export const FEEDBACK_MAIL_MAX = 50
/** Serialises the day's claim, so two runs of the cron cannot both send. */
const FEEDBACK_MAIL_LOCK = 7274

interface FeedbackRow {
  readonly id: number
  readonly user_id: string | null
  readonly kind: FeedbackKind
  readonly message: string
  readonly contact_email: string
  readonly app_version: string
  readonly corpus_version: string
  readonly user_agent: string
  readonly language: string
  readonly screen: string
  readonly received_at: number
}

const KIND: Readonly<Record<FeedbackKind, string>> = { bug: 'Something isn’t working', idea: 'An idea', other: 'Something else' }

/** `2026-10-10 14:03 UTC`. */
const stamp = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`

/** The mail's text: each message with what was sent beside it, oldest first, and how many more are waiting. */
export function feedbackMail(rows: readonly FeedbackRow[], waiting: number): { readonly subject: string; readonly text: string } {
  const items = rows.map((row, i) =>
    [
      `${i + 1}. ${KIND[row.kind]} · ${stamp(row.received_at)}`,
      '',
      row.message,
      '',
      ...(row.contact_email === '' ? [] : [`Answer to: ${row.contact_email}`]),
      `Signed in: ${row.user_id === null ? 'no' : 'yes'}`,
      `App: ${row.app_version} · Words: ${row.corpus_version === '' ? 'none' : row.corpus_version} · Language: ${row.language} · Screen: ${row.screen}`,
      `Browser: ${row.user_agent}`,
    ].join('\n'),
  )
  const more = waiting - rows.length
  if (more > 0) items.push(`and ${more} more`)
  return { subject: `Wordado feedback: ${waiting} new`, text: items.join('\n\n----\n\n') }
}

/**
 * The cron's step (spec §8.12): one mail a day, at most, with the feedback
 * no mail has carried yet. The day is claimed before the mail is sent, so a
 * send that fails is not tried again until the next UTC day, when the same
 * messages are still waiting: the mail allowance is shared with sign-in
 * codes (spec §17.2). Without `FEEDBACK_EMAIL` nothing is sent or marked,
 * and one line says how many are waiting. Returns how many were mailed.
 */
export async function mailNewFeedback(deps: ServerDeps): Promise<number> {
  const to = deps.config.feedbackEmail
  if (to === null) {
    const [row] = await deps.db.query<{ n: number }>('select count(*)::int as n from feedback where mailed_at is null')
    if (row && row.n > 0) console.log(`feedback: ${row.n} waiting, FEEDBACK_EMAIL is not set`)
    return 0
  }
  const now = deps.now()
  const today = utcDay(now)
  const claimed = await deps.db.transaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock($1)', [FEEDBACK_MAIL_LOCK])
    const [count] = await tx.query<{ n: number }>('select count(*)::int as n from feedback where mailed_at is null')
    if (!count || count.n === 0) return null
    await tx.query('delete from feedback_mail where utc_day < $1', [today])
    const [day] = await tx.query('insert into feedback_mail (utc_day, attempted_at) values ($1, $2) on conflict do nothing returning utc_day', [today, now])
    if (!day) return null
    const rows = await tx.query<FeedbackRow>(
      `select id, user_id, kind, message, contact_email, app_version, corpus_version, user_agent, language, screen, received_at
       from feedback where mailed_at is null order by received_at, id limit $1`,
      [FEEDBACK_MAIL_MAX],
    )
    return { rows, waiting: count.n }
  })
  if (claimed === null) return 0
  await deps.mailer.sendFeedback(to, feedbackMail(claimed.rows, claimed.waiting))
  await deps.db.query('update feedback set mailed_at = $1 where id = any($2::bigint[])', [now, claimed.rows.map((row) => row.id)])
  return claimed.rows.length
}
