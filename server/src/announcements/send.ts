import { announcementTextFor, type AnnouncementKind, type AnnouncementLanguage, type AnnouncementTexts } from '@wordado/core'
import type { Queryable } from '../db/db'
import type { AnnouncementMail, ServerDeps } from '../deps'
import { MailNotSent } from '../mail'
import { countMails, mailsSentOn, utcDayOf, type HeldReason } from './store'
import { composeAnnouncementMail, CONTACT_ADDRESS } from './text'
import { unsubscribeToken, unsubscribeUrl } from './unsubscribe'

/**
 * The mails one run of the cron handles at most. A run is one invocation of the Worker, which on the free plan
 * may make 50 requests to other services (developers.cloudflare.com/workers/platform/limits, "Subrequests"); the
 * reminders of the same run are among them. 20 leaves them room, and at four runs an hour is 1,920 mails a day,
 * far above the day's allowance below, so the batch is never what holds a send back.
 */
export const ANNOUNCEMENT_BATCH = 20
/**
 * The wait between two mails of a run: 2 a second. The provider allows 10 requests a second for the whole
 * account (resend.com/docs/api-reference/rate-limit, read 2026-10-11), which the sign-in codes and the review
 * app's mails share.
 */
export const ANNOUNCEMENT_SEND_INTERVAL_MS = 500
/**
 * How long a try with no known outcome is left alone before it is made again: two periods of the cron, so a run
 * still waiting for the provider's answer is never overtaken by the next.
 */
export const ANNOUNCEMENT_CLAIM_MS = 30 * 60_000
/**
 * How long after its first use a key still makes a second request the same mail. The provider keeps a key for
 * 24 hours (resend.com/docs/api-reference/emails/send-email, "Idempotency-Key"); an hour less, to be on the safe
 * side of its clock. Past it, a mail whose outcome never became known is not tried again.
 */
export const ANNOUNCEMENT_KEY_WINDOW_MS = 23 * 3_600_000
/** The tries with no known outcome one mail gets, each ANNOUNCEMENT_CLAIM_MS after the last. */
export const MAX_ANNOUNCEMENT_ATTEMPTS = 5

export interface AnnouncementRun {
  readonly sent: number
  /** Mails given up on: the provider will not take them, or their outcome never became known. */
  readonly failed: number
  /** News not sent because the consent was withdrawn since the send started. */
  readonly skipped: number
  /** Why the run stopped with mails still waiting; null when it ran its batch or ran out of mails. */
  readonly held: HeldReason | null
}

interface Claimed {
  readonly announcement_id: number
  readonly user_id: string
  readonly language: AnnouncementLanguage
  readonly send_key: string
  readonly attempts: number
  readonly first_tried_at: number | null
  readonly kind: AnnouncementKind
  readonly texts: AnnouncementTexts
  readonly email: string
  readonly news_consent: string
}

/** A mail `d` that may be taken at `$1`, the time before which a try with no known outcome is old enough to repeat. */
const WAITING = `a.status = 'sending' and d.status = 'queued' and (d.claimed_at is null or d.claimed_at <= $1)`

/** Ends a mail one way or another and counts it on its announcement, in the caller's transaction. */
async function settle(tx: Queryable, mail: Pick<Claimed, 'announcement_id' | 'user_id'>, status: 'sent' | 'failed' | 'skipped', now: number): Promise<void> {
  const done = await tx.query(
    `update announcement_delivery set status = $3, done_at = $4, claimed_at = null where announcement_id = $1 and user_id = $2 and status = 'queued' returning 1 as one`,
    [mail.announcement_id, mail.user_id, status, now],
  )
  // The column is one of three names written here, never a request's text.
  if (done.length > 0) await tx.query(`update announcement set ${status} = ${status} + 1 where id = $1`, [mail.announcement_id])
}

/**
 * Takes the next waiting mail, oldest announcement first, and marks it as being tried, in one transaction: the
 * row is locked while it is looked at, and a run that came at the same time skips it. Answers the mail to send,
 * or what became of it without a send, or null when none waits.
 *
 * Consent is asked here, at the moment of sending: news goes to nobody who withdrew since the send started.
 */
async function take(deps: ServerDeps, now: number): Promise<Claimed | 'skipped' | 'failed' | null> {
  return deps.db.transaction(async (tx) => {
    const [mail] = await tx.query<Claimed>(
      `select d.announcement_id, d.user_id, d.language, d.send_key, d.attempts, d.first_tried_at, a.kind, a.texts, u.email, u.news_consent
       from announcement_delivery d join announcement a on a.id = d.announcement_id join "user" u on u.id = d.user_id
       where ${WAITING} order by a.started_at, a.id, d.user_id limit 1 for update of d skip locked`,
      [now - ANNOUNCEMENT_CLAIM_MS],
    )
    if (!mail) return null
    if (mail.kind === 'news' && mail.news_consent !== 'given') {
      await settle(tx, mail, 'skipped', now)
      return 'skipped'
    }
    // Tried before, with no answer that said whether it went. Another try is the same mail to the provider only
    // while the key holds; after that, or after enough tries, it is given up rather than risked twice.
    if (mail.first_tried_at !== null && (mail.attempts >= MAX_ANNOUNCEMENT_ATTEMPTS || now - mail.first_tried_at >= ANNOUNCEMENT_KEY_WINDOW_MS)) {
      await settle(tx, mail, 'failed', now)
      return 'failed'
    }
    await tx.query(
      'update announcement_delivery set claimed_at = $3, first_tried_at = coalesce(first_tried_at, $3), attempts = attempts + 1 where announcement_id = $1 and user_id = $2',
      [mail.announcement_id, mail.user_id, now],
    )
    return { ...mail, attempts: mail.attempts + 1 }
  })
}

/**
 * Puts a mail back among the waiting after the provider answered that it did not send it for now. That is no
 * fault of the recipient, so the try is not counted. If it was the first with its key, the mail gets a new key
 * and is as if never tried. If an earlier try got no answer, that one may have gone: the key stays, so the next
 * request is still that same mail.
 */
async function release(deps: ServerDeps, mail: Claimed): Promise<void> {
  await deps.db.query(
    mail.attempts <= 1
      ? `update announcement_delivery set claimed_at = null, first_tried_at = null, attempts = 0, send_key = gen_random_uuid() where announcement_id = $1 and user_id = $2 and status = 'queued'`
      : `update announcement_delivery set claimed_at = null, attempts = attempts - 1 where announcement_id = $1 and user_id = $2 and status = 'queued'`,
    [mail.announcement_id, mail.user_id],
  )
}

async function mailFor(deps: ServerDeps, mail: Claimed): Promise<AnnouncementMail> {
  // The link is made for the language of the mail, which is English where the announcement has no text in the account's.
  const { language } = announcementTextFor(mail.texts, mail.language)
  const link = mail.kind === 'news' ? unsubscribeUrl(deps.config, await unsubscribeToken(deps.config.authSecret, { userId: mail.user_id }), language) : null
  const composed = composeAnnouncementMail(mail.kind, mail.texts, mail.language, link)
  return {
    to: mail.email,
    subject: composed.subject,
    text: composed.text,
    headers: composed.headers,
    replyTo: CONTACT_ADDRESS,
    // The announcement and the row's own random key: nothing of the account.
    idempotencyKey: `announcement/${mail.announcement_id}/${mail.send_key}`,
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The cron's step (#185): sends the waiting mails of every announcement being sent, at most ANNOUNCEMENT_BATCH a
 * run and `announcementMailsPerDay` a UTC day, one at a time with a wait between. Each mail is a row of its own
 * (announcement_delivery), ended in the same transaction that counts it, so a run may stop anywhere, be it by a
 * crash, and the next goes on from there:
 *
 * - a mail the provider took is `sent`, and no run takes it again;
 * - one it will never take is `failed`, and the run goes on;
 * - when it takes nothing now, or its allowance is used up, the mail waits as if untried and the run stops;
 * - when no answer came, the mail may or may not have gone: it is tried again later with the same key, which the
 *   provider treats as the same mail, and given up as `failed` once that can no longer be relied on.
 *
 * An announcement with no mail left waiting is `sent`. The log has counts and nothing of an account.
 */
export async function sendAnnouncements(deps: ServerDeps, pause: (ms: number) => Promise<void> = wait): Promise<AnnouncementRun> {
  const run = { sent: 0, failed: 0, skipped: 0 }
  let held: HeldReason | null = null
  if ((await deps.db.query(`select 1 as one from announcement where status = 'sending' limit 1`)).length === 0) return { ...run, held }
  const now = deps.now()
  let left = deps.config.announcementMailsPerDay - (await mailsSentOn(deps.db, now))
  for (let handled = 0; handled < ANNOUNCEMENT_BATCH && held === null; handled += 1) {
    if (left <= 0) {
      const waiting = await deps.db.query(`select 1 as one from announcement_delivery d join announcement a on a.id = d.announcement_id where ${WAITING} limit 1`, [now - ANNOUNCEMENT_CLAIM_MS])
      if (waiting.length > 0) held = 'day'
      break
    }
    const mail = await take(deps, now)
    if (mail === null) break
    if (mail === 'skipped' || mail === 'failed') {
      run[mail] += 1
      continue
    }
    if (run.sent > 0) await pause(ANNOUNCEMENT_SEND_INTERVAL_MS)
    try {
      await deps.mailer.sendAnnouncement(await mailFor(deps, mail))
    } catch (error) {
      if (error instanceof MailNotSent && error.reason === 'refused') {
        await settle(deps.db, mail, 'failed', now)
        run.failed += 1
        continue
      }
      if (error instanceof MailNotSent) {
        const reason = error.reason === 'quota' ? 'quota' : 'busy'
        await release(deps, mail)
        held = reason
        // The provider's allowance is used up: the day is over for announcements, and no later run asks again.
        if (reason === 'quota') {
          await deps.db.query(
            'insert into announcement_mail_day (utc_day, mails) values ($1, $2) on conflict (utc_day) do update set mails = greatest(announcement_mail_day.mails, excluded.mails)',
            [utcDayOf(now), deps.config.announcementMailsPerDay],
          )
        }
      } else {
        // No answer: the row stays as it is, to be tried again with the same key. The error's name only, since
        // its text is not this code's and a log has nothing of a recipient.
        console.error(`announcement mail: no answer from the mailer (${error instanceof Error ? error.name : 'error'})`)
        held = 'busy'
      }
      break
    }
    await deps.db.transaction(async (tx) => {
      await settle(tx, mail, 'sent', now)
      await countMails(tx, now, 1)
    })
    run.sent += 1
    left -= 1
  }
  await deps.db.query(
    `update announcement a set status = 'sent', finished_at = $1, updated_at = $1, held_reason = null, held_at = null
     where a.status = 'sending' and not exists (select 1 from announcement_delivery d where d.announcement_id = a.id and d.status = 'queued')`,
    [now],
  )
  // What the tab shows of a send that does not move: why, and since when. A run that was not held clears it.
  await deps.db.query(`update announcement set held_reason = $1, held_at = case when $1::text is null then null else $2::bigint end where status = 'sending' and held_reason is distinct from $1`, [held, now])
  if (run.sent + run.failed + run.skipped > 0) console.log(`announcements: ${run.sent} sent, ${run.failed} failed, ${run.skipped} skipped`)
  return { ...run, held }
}
