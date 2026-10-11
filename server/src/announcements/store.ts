import {
  ANNOUNCEMENT_FALLBACK_LANGUAGE,
  ANNOUNCEMENT_LANGUAGES,
  announcementTextFor,
  DOCUMENT_TYPES,
  SUPPORTED_L1S,
  type AnnouncementKind,
  type AnnouncementLanguage,
  type AnnouncementTexts,
} from '@wordado/core'
import type { Db, Queryable } from '../db/db'

export type AnnouncementStatus = 'draft' | 'sending' | 'stopped' | 'sent'
/** Why a run sent nothing or stopped early: the day's own allowance is used, the provider's is, or the provider takes nothing now. */
export type HeldReason = 'day' | 'quota' | 'busy'

export interface AnnouncementRow {
  readonly id: number
  readonly kind: AnnouncementKind
  readonly texts: AnnouncementTexts
  readonly version: number
  readonly tested_version: number | null
  readonly status: AnnouncementStatus
  readonly created_at: number
  readonly updated_at: number
  readonly started_at: number | null
  readonly stopped_at: number | null
  readonly finished_at: number | null
  readonly held_reason: HeldReason | null
  readonly held_at: number | null
  readonly recipients: number
  readonly sent: number
  readonly failed: number
  readonly skipped: number
  readonly queued: number
}

/** An announcement as the review app is told of it: its texts, its state and counts. Nothing of an account. */
export interface AnnouncementView {
  readonly id: number
  readonly kind: AnnouncementKind
  readonly texts: AnnouncementTexts
  /** Raised by every change of a draft; `testedVersion` is the one whose test send went, null before any. */
  readonly version: number
  readonly testedVersion: number | null
  readonly status: AnnouncementStatus
  readonly createdAt: number
  readonly updatedAt: number
  readonly startedAt: number | null
  readonly stoppedAt: number | null
  readonly finishedAt: number | null
  /** Why the last run sent nothing or stopped early, and when; null when it did neither. */
  readonly held: { readonly reason: HeldReason; readonly at: number } | null
  /** The accounts it was for when sending started, and what became of their mails. What these do not add up to
   * are accounts deleted before their turn. */
  readonly recipients: number
  readonly sent: number
  readonly failed: number
  readonly skipped: number
  readonly queued: number
}

const COLUMNS = `a.id, a.kind, a.texts, a.version, a.tested_version, a.status, a.created_at, a.updated_at, a.started_at, a.stopped_at, a.finished_at,
  a.held_reason, a.held_at, a.recipients, a.sent, a.failed, a.skipped,
  (select count(*) from announcement_delivery d where d.announcement_id = a.id and d.status = 'queued')::int as queued`

export function toView(row: AnnouncementRow): AnnouncementView {
  return {
    id: row.id,
    kind: row.kind,
    texts: row.texts,
    version: row.version,
    testedVersion: row.tested_version,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    finishedAt: row.finished_at,
    held: row.held_reason !== null && row.held_at !== null ? { reason: row.held_reason, at: row.held_at } : null,
    recipients: row.recipients,
    sent: row.sent,
    failed: row.failed,
    skipped: row.skipped,
    queued: row.queued,
  }
}

/** The announcements the list shows: the newest. */
export const ANNOUNCEMENT_LIST_LIMIT = 50

export async function listAnnouncements(db: Queryable): Promise<AnnouncementRow[]> {
  return db.query<AnnouncementRow>(`select ${COLUMNS} from announcement a order by a.id desc limit $1`, [ANNOUNCEMENT_LIST_LIMIT])
}

export async function readAnnouncement(db: Queryable, id: number, lock = false): Promise<AnnouncementRow | null> {
  const [row] = await db.query<AnnouncementRow>(`select ${COLUMNS} from announcement a where a.id = $1${lock ? ' for update of a' : ''}`, [id])
  return row ?? null
}

/** What a request met instead of the state it needs: the page is told which. */
export class AnnouncementRefused extends Error {
  constructor(
    readonly code: 'not_found' | 'not_draft' | 'not_sending' | 'not_stopped' | 'stale' | 'untested' | 'changed' | 'nobody',
    /** With `changed`: how many accounts it would go to now. */
    readonly recipients?: number,
  ) {
    super(code)
  }
}

/** Writes a new draft, or changes one: every change is a new version, which no test send has seen. */
export async function saveDraft(db: Db, id: number | null, kind: AnnouncementKind, texts: AnnouncementTexts, now: number): Promise<AnnouncementRow> {
  return db.transaction(async (tx) => {
    if (id === null) {
      const [made] = await tx.query<{ id: number }>('insert into announcement (kind, texts, created_at, updated_at) values ($1, $2, $3, $3) returning id', [kind, JSON.stringify(texts), now])
      return (await readAnnouncement(tx, made!.id))!
    }
    const row = await readAnnouncement(tx, id, true)
    if (row === null) throw new AnnouncementRefused('not_found')
    if (row.status !== 'draft') throw new AnnouncementRefused('not_draft')
    await tx.query('update announcement set kind = $2, texts = $3, version = version + 1, updated_at = $4 where id = $1', [id, kind, JSON.stringify(texts), now])
    return (await readAnnouncement(tx, id))!
  })
}

/** Removes a draft. What was sent, or began to be, stays: it is the record of what account holders were told. */
export async function deleteDraft(db: Db, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await readAnnouncement(tx, id, true)
    if (row === null) throw new AnnouncementRefused('not_found')
    if (row.status !== 'draft') throw new AnnouncementRefused('not_draft')
    await tx.query('delete from announcement where id = $1', [id])
  })
}

const quoted = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(', ')

/**
 * The interface language of an account `u`, as far as the server knows it. The app keeps that choice on the
 * device and does not send it as such, so it is read from what the app did send, the most direct first: the
 * language the account's newest device asks its reminders in (the interface language at that moment); the
 * language it read the question about news in (`news-1.bg`, 0009); its native language from the synced settings,
 * which the interface speaks unless the learner chose English. Null for an account that left none of these: the
 * counts by language (account/stats.ts) show it as not known. The lists are this module's own constants, never a
 * request's text.
 */
export const KNOWN_LANGUAGE_OF = `coalesce(
  (select p.language from push_subscription p where p.user_id = u.id and p.language in (${quoted(ANNOUNCEMENT_LANGUAGES)}) order by p.created_at desc, p.endpoint limit 1),
  case when right(u.news_consent_text, 3) in (${quoted(ANNOUNCEMENT_LANGUAGES.map((l) => `.${l}`))}) then right(u.news_consent_text, 2) end,
  (select s.fields->>'l1' from document s where s.user_id = u.id and s.type = '${DOCUMENT_TYPES.settings}' and s.key = '' and not s.deleted
     and s.fields->>'l1' in (${quoted(SUPPORTED_L1S.filter((l) => (ANNOUNCEMENT_LANGUAGES as readonly string[]).includes(l)))})))`

/** The language an account `u` is written to in: its own (above), or English when it left no sign of one. */
const LANGUAGE_OF = `coalesce(${KNOWN_LANGUAGE_OF}, '${ANNOUNCEMENT_FALLBACK_LANGUAGE}')`

/** Whether an account `u` gets an announcement of kind `$1`: every account a service notice, only one whose consent stands the news. */
const RECIPIENT = `($1 = 'service' or u.news_consent = 'given')`

/**
 * How many accounts an announcement would go to if it were sent now, by the language of the mail each would get:
 * the account's own where the announcement has a text in it, English otherwise.
 */
export async function countRecipients(db: Queryable, kind: AnnouncementKind, texts: AnnouncementTexts): Promise<{ recipients: number; byLanguage: Partial<Record<AnnouncementLanguage, number>> }> {
  const rows = await db.query<{ language: AnnouncementLanguage; accounts: number }>(`select ${LANGUAGE_OF} as language, count(*)::int as accounts from "user" u where ${RECIPIENT} group by 1`, [kind])
  const byLanguage: Partial<Record<AnnouncementLanguage, number>> = {}
  let recipients = 0
  for (const row of rows) {
    const { language } = announcementTextFor(texts, row.language)
    byLanguage[language] = (byLanguage[language] ?? 0) + row.accounts
    recipients += row.accounts
  }
  return { recipients, byLanguage }
}

/** What the owner confirmed when pressing send: the version read, its kind, and the number of accounts shown. */
export interface SendConfirmation {
  readonly version: number
  readonly kind: AnnouncementKind
  readonly recipients: number
}

/**
 * Starts sending (#185): in one transaction, with the announcement's row locked, so two presses start it once.
 * It must still be a draft, of the version and kind the owner read, and that version's test send must have gone.
 * Who gets it is fixed here, one row an account: an account made later is not among them. If that is not the
 * number the owner confirmed, nothing starts and the number is given back to be confirmed again. No mail goes
 * from here: the cron's step sends (send.ts).
 */
export async function startAnnouncement(db: Db, id: number, confirmed: SendConfirmation, now: number): Promise<AnnouncementRow> {
  return db.transaction(async (tx) => {
    const row = await readAnnouncement(tx, id, true)
    if (row === null) throw new AnnouncementRefused('not_found')
    if (row.status !== 'draft') throw new AnnouncementRefused('not_draft')
    if (row.version !== confirmed.version || row.kind !== confirmed.kind) throw new AnnouncementRefused('stale')
    if (row.tested_version !== row.version) throw new AnnouncementRefused('untested')
    const queued = await tx.query(
      `insert into announcement_delivery (announcement_id, user_id, language) select $2, u.id, ${LANGUAGE_OF} from "user" u where ${RECIPIENT} returning 1 as one`,
      [row.kind, id],
    )
    // Thrown, so the rows just written go with the transaction.
    if (queued.length !== confirmed.recipients) throw new AnnouncementRefused('changed', queued.length)
    if (queued.length === 0) throw new AnnouncementRefused('nobody')
    await tx.query(`update announcement set status = 'sending', started_at = $2, updated_at = $2, recipients = $3 where id = $1`, [id, now, queued.length])
    return (await readAnnouncement(tx, id))!
  })
}

/** Stops a send where it is: the cron's step takes no more of its mails. One already handed to the provider still goes. */
export async function stopAnnouncement(db: Db, id: number, now: number): Promise<AnnouncementRow> {
  return db.transaction(async (tx) => {
    const row = await readAnnouncement(tx, id, true)
    if (row === null) throw new AnnouncementRefused('not_found')
    if (row.status !== 'sending') throw new AnnouncementRefused('not_sending')
    await tx.query(`update announcement set status = 'stopped', stopped_at = $2, updated_at = $2, held_reason = null, held_at = null where id = $1`, [id, now])
    return (await readAnnouncement(tx, id))!
  })
}

/** Goes on with a stopped send: to the accounts it was for when it started and has not reached, and to nobody a second time. */
export async function resumeAnnouncement(db: Db, id: number, now: number): Promise<AnnouncementRow> {
  return db.transaction(async (tx) => {
    const row = await readAnnouncement(tx, id, true)
    if (row === null) throw new AnnouncementRefused('not_found')
    if (row.status !== 'stopped') throw new AnnouncementRefused('not_stopped')
    await tx.query(`update announcement set status = 'sending', stopped_at = null, updated_at = $2 where id = $1`, [id, now])
    return (await readAnnouncement(tx, id))!
  })
}

/** Records that the test send of `version` went, if that is still the version there is. */
export async function markTested(db: Queryable, id: number, version: number): Promise<void> {
  await db.query(`update announcement set tested_version = $2 where id = $1 and version = $2 and status = 'draft'`, [id, version])
}

const DAY_MS = 86_400_000
export const utcDayOf = (now: number): number => Math.floor(now / DAY_MS)

/** The announcement mails sent on the UTC day of `now`, test sends among them. */
export async function mailsSentOn(db: Queryable, now: number): Promise<number> {
  const [row] = await db.query<{ mails: number }>('select mails from announcement_mail_day where utc_day = $1', [utcDayOf(now)])
  return row?.mails ?? 0
}

export async function countMails(db: Queryable, now: number, mails: number): Promise<void> {
  await db.query('insert into announcement_mail_day (utc_day, mails) values ($1, $2) on conflict (utc_day) do update set mails = announcement_mail_day.mails + excluded.mails', [utcDayOf(now), mails])
}
