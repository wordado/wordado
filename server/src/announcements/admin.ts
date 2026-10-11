import { ANNOUNCEMENT_LANGUAGES, isAnnouncementKind, validateAnnouncementTexts } from '@wordado/core'
import type { Context, Hono } from 'hono'
import { requireAdminWriteToken } from '../adminToken'
import type { ServerDeps } from '../deps'
import { invalid, readJson, type AppEnv } from '../http'
import { MailNotSent } from '../mail'
import { ANNOUNCEMENT_BATCH } from './send'
import {
  AnnouncementRefused,
  countMails,
  countRecipients,
  deleteDraft,
  listAnnouncements,
  mailsSentOn,
  markTested,
  readAnnouncement,
  resumeAnnouncement,
  saveDraft,
  startAnnouncement,
  stopAnnouncement,
  toView,
  type AnnouncementRow,
} from './store'
import { composeAnnouncementMail, CONTACT_ADDRESS, type ComposedMail } from './text'
import { unsubscribeToken, unsubscribeUrl } from './unsubscribe'

/** The longest address a test send goes to; a longer one is no address. */
const MAX_EMAIL_LENGTH = 320
/** What marks the subject of a test send, so it is not taken for the announcement itself. */
export const TEST_SUBJECT_PREFIX = '[Test] '

const fieldsOf = (body: unknown): Record<string, unknown> => (typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {})
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** The one address of a test send: a single address with no space or control character in it, so it is one recipient and no header. */
function emailOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim()
  return email.length <= MAX_EMAIL_LENGTH && /^[^\s@,;<>"\p{Cc}]+@[^\s@,;<>"\p{Cc}]+$/u.test(email) ? email : null
}

const STATUS_OF: Record<AnnouncementRefused['code'], 404 | 409> = {
  not_found: 404,
  not_draft: 409,
  not_sending: 409,
  not_stopped: 409,
  stale: 409,
  untested: 409,
  changed: 409,
  nobody: 409,
}

/**
 * Announcements, for the review app's tab (#185): a mail written there and sent from here to account holders.
 * The caller is the review app's server, with `ADMIN_WRITE_TOKEN` (src/adminToken.ts) and no cookie: writing an
 * announcement, the test send and the send itself all change something, and mailing every account holder is the
 * largest change this server makes, so none of it answers to the token that only reads.
 *
 * What guards the send, since a mail cannot be taken back:
 * - the version to be sent must have been mailed to one address first (`test`), and a change after that needs it again;
 * - `send` names the version and the kind and the number of accounts the owner was shown, and is refused if any differs now;
 * - sending starts once: after it nothing of the announcement changes, and it cannot be started again;
 * - `stop` halts a send where it is, `resume` goes on with those not yet reached.
 *
 * Nothing answered here is of an account: counts and times. The address of a test send comes in the body, is
 * used for that one send and is kept nowhere.
 */
export function announcementAdminRoutes(app: Hono<AppEnv>, deps: ServerDeps): void {
  const admin = requireAdminWriteToken(deps)

  /** Runs a change and answers the announcement after it, or why the change was refused. */
  const changed = async (c: Context<AppEnv>, change: () => Promise<AnnouncementRow>): Promise<Response> => {
    try {
      const row = await change()
      c.header('cache-control', 'no-store')
      return c.json({ announcement: toView(row) })
    } catch (error) {
      if (error instanceof AnnouncementRefused) return refused(c, error)
      throw error
    }
  }
  const refused = (c: Context<AppEnv>, error: AnnouncementRefused) => c.json({ error: error.code, ...(error.recipients === undefined ? {} : { recipients: error.recipients }) }, STATUS_OF[error.code])

  /** The mails of an announcement, one for each language it is written in. News carries the link of a test send, which withdraws nobody's consent. */
  const mailsOf = async (row: AnnouncementRow): Promise<ComposedMail[]> => {
    const token = row.kind === 'news' ? await unsubscribeToken(deps.config.authSecret, 'test') : null
    return ANNOUNCEMENT_LANGUAGES.filter((language) => row.texts[language]).map((language) =>
      composeAnnouncementMail(row.kind, row.texts, language, token === null ? null : unsubscribeUrl(deps.config, token, language)),
    )
  }

  app.get('/v1/admin/announcements', admin, async (c) => {
    const now = deps.now()
    const [rows, sentToday] = await Promise.all([listAnnouncements(deps.db), mailsSentOn(deps.db, now)])
    c.header('cache-control', 'no-store')
    return c.json({ announcements: rows.map(toView), limits: { perDay: deps.config.announcementMailsPerDay, sentToday, batch: ANNOUNCEMENT_BATCH } })
  })

  /** Writes a draft (`{kind, texts}`) or changes one (`{id, kind, texts}`). */
  app.post('/v1/admin/announcements/save', admin, async (c) => {
    const { id, kind, texts } = fieldsOf(await readJson(c))
    const checked = validateAnnouncementTexts(texts)
    const errors = [...(id === undefined || isId(id) ? [] : ['id must be the number of an announcement']), ...(isAnnouncementKind(kind) ? [] : ['kind must be service or news']), ...(checked.ok ? [] : checked.errors)]
    if (errors.length > 0 || !checked.ok || !isAnnouncementKind(kind)) return invalid(c, errors)
    return changed(c, () => saveDraft(deps.db, isId(id) ? id : null, kind, checked.texts, deps.now()))
  })

  app.post('/v1/admin/announcements/delete', admin, async (c) => {
    const { id } = fieldsOf(await readJson(c))
    if (!isId(id)) return invalid(c, ['send {"id": <the announcement>}'])
    try {
      await deleteDraft(deps.db, id)
    } catch (error) {
      if (error instanceof AnnouncementRefused) return refused(c, error)
      throw error
    }
    return c.json({ deleted: true })
  })

  /** Each language as it would be mailed, and how many accounts would get which if it were sent now. */
  app.post('/v1/admin/announcements/preview', admin, async (c) => {
    const { id } = fieldsOf(await readJson(c))
    if (!isId(id)) return invalid(c, ['send {"id": <the announcement>}'])
    const row = await readAnnouncement(deps.db, id)
    if (row === null) return c.json({ error: 'not_found' }, 404)
    const [mails, counts] = await Promise.all([mailsOf(row), countRecipients(deps.db, row.kind, row.texts)])
    c.header('cache-control', 'no-store')
    return c.json({ version: row.version, kind: row.kind, ...counts, mails: mails.map(({ language, subject, text }) => ({ language, subject, text })) })
  })

  /**
   * The test send: every language of this version to one address, made as the real mails are. Only when the
   * mailer took them all is the version marked as tested. The address is in the body and is not kept.
   */
  app.post('/v1/admin/announcements/test', admin, async (c) => {
    const { id, version, email: rawEmail } = fieldsOf(await readJson(c))
    const email = emailOf(rawEmail)
    if (!isId(id) || !isId(version) || email === null) return invalid(c, ['send {"id": <the announcement>, "version": <the version read>, "email": "<one address>"}'])
    const row = await readAnnouncement(deps.db, id)
    if (row === null) return c.json({ error: 'not_found' }, 404)
    if (row.status !== 'draft') return c.json({ error: 'not_draft' }, 409)
    if (row.version !== version) return c.json({ error: 'stale' }, 409)
    const mails = await mailsOf(row)
    const now = deps.now()
    let went = 0
    try {
      for (const mail of mails) {
        await deps.mailer.sendAnnouncement({
          to: email,
          subject: `${TEST_SUBJECT_PREFIX}${mail.subject}`,
          text: mail.text,
          headers: mail.headers,
          replyTo: CONTACT_ADDRESS,
          // A key of this press alone: a second test send is a second mail.
          idempotencyKey: `announcement-test/${row.id}/${crypto.randomUUID()}`,
        })
        went += 1
      }
    } catch (error) {
      console.error(`announcement test send: not sent (${error instanceof MailNotSent ? error.reason : error instanceof Error ? error.name : 'error'})`)
      return c.json({ error: 'mail_not_sent', reason: error instanceof MailNotSent ? error.reason : 'unknown' }, 502)
    } finally {
      // Counted in the day's allowance, which is the provider's too, but never held back by it: a test is a few mails.
      if (went > 0) await countMails(deps.db, now, went)
    }
    await markTested(deps.db, row.id, row.version)
    c.header('cache-control', 'no-store')
    return c.json({ announcement: toView((await readAnnouncement(deps.db, row.id))!), mails: went })
  })

  /** Starts sending: `{id, version, kind, recipients}`, the last three as the owner confirmed them. */
  app.post('/v1/admin/announcements/send', admin, async (c) => {
    const { id, version, kind, recipients } = fieldsOf(await readJson(c))
    if (!isId(id) || !isId(version) || !isAnnouncementKind(kind) || !isCount(recipients)) {
      return invalid(c, ['send {"id": <the announcement>, "version": <the version read>, "kind": <its kind>, "recipients": <the number of accounts shown>}'])
    }
    return changed(c, async () => {
      const row = await startAnnouncement(deps.db, id, { version, kind, recipients }, deps.now())
      console.log(`announcements: sending of 1 ${row.kind} announcement started, ${row.recipients} recipient(s)`)
      return row
    })
  })

  app.post('/v1/admin/announcements/stop', admin, async (c) => {
    const { id } = fieldsOf(await readJson(c))
    if (!isId(id)) return invalid(c, ['send {"id": <the announcement>}'])
    return changed(c, () => stopAnnouncement(deps.db, id, deps.now()))
  })

  app.post('/v1/admin/announcements/resume', admin, async (c) => {
    const { id } = fieldsOf(await readJson(c))
    if (!isId(id)) return invalid(c, ['send {"id": <the announcement>}'])
    return changed(c, () => resumeAnnouncement(deps.db, id, deps.now()))
  })
}
