import { type AnnouncementKind, type AnnouncementTexts } from '@wordado/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestUser } from '../../test/db'
import { harness, type Harness, type Reply } from '../../test/harness'
import { deleteAccount } from '../account/deletion'
import { INACTIVE_ACCOUNT_MS, sweepInactiveAccounts } from '../account/sweep'
import { runScheduled } from '../jobs/scheduled'
import { MailNotSent } from '../mail'
import {
  ANNOUNCEMENT_BATCH,
  ANNOUNCEMENT_CLAIM_MS,
  ANNOUNCEMENT_KEY_WINDOW_MS,
  ANNOUNCEMENT_SEND_INTERVAL_MS,
  MAX_ANNOUNCEMENT_ATTEMPTS,
  sendAnnouncements,
} from './send'
import { CONTACT_ADDRESS } from './text'

const DAY = 86_400_000
const token = 'w'.repeat(40)
const readToken = 'r'.repeat(40)
const withToken = (config: { announcementMailsPerDay?: number } = {}) => harness({ config: { adminWriteToken: token, feedbackReadToken: readToken, ...config } })
const OWNER = 'owner@example.com'

const en = { subject: 'The terms change on 1 December', body: 'Hello,\n\nthe terms change.' }
const bg = { subject: 'Условията се променят', body: 'Здравейте.' }

/** As the review app's server asks: the token, a JSON body, and no Origin or cookie. */
const ask = (h: Harness, path: string, body?: unknown, authorization: string | null = `Bearer ${token}`): Promise<Reply> =>
  h.request(`/v1/admin/announcements${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(authorization === null ? {} : { authorization }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

interface View {
  id: number
  kind: AnnouncementKind
  status: string
  version: number
  testedVersion: number | null
  recipients: number
  sent: number
  failed: number
  skipped: number
  queued: number
  held: { reason: string; at: number } | null
  startedAt: number | null
  stoppedAt: number | null
  finishedAt: number | null
}

async function draft(h: Harness, kind: AnnouncementKind = 'service', texts: Partial<AnnouncementTexts> = { en }): Promise<View> {
  const reply = await ask(h, '/save', { kind, texts })
  expect(reply.status).toBe(200)
  return reply.body.announcement as View
}

/** A draft whose test send went. */
async function tested(h: Harness, kind: AnnouncementKind = 'service', texts: Partial<AnnouncementTexts> = { en }): Promise<View> {
  const a = await draft(h, kind, texts)
  const reply = await ask(h, '/test', { id: a.id, version: a.version, email: OWNER })
  expect(reply.status).toBe(200)
  h.announcements.length = 0
  return { ...a, testedVersion: a.version }
}

/** Presses send as the tab does: with the kind and the count the preview showed. */
async function start(h: Harness, a: View): Promise<View> {
  const { recipients } = (await ask(h, '/preview', { id: a.id })).body as { recipients: number }
  const reply = await ask(h, '/send', { id: a.id, version: a.version, kind: a.kind, recipients })
  expect(reply.status).toBe(200)
  return reply.body.announcement as View
}

const one = async (h: Harness, id: number): Promise<View> => ((await ask(h, '')).body.announcements as View[]).find((a) => a.id === id)!

/** A run of the cron's step without the wait between mails. */
const run = (h: Harness) => sendAnnouncements(h.deps, async () => undefined)

async function accounts(h: Harness, count: number, consent: 'none' | 'given' | 'withdrawn' = 'none', language = 'en'): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < count; i += 1) {
    const id = await createTestUser(h.deps.db)
    if (consent !== 'none') await h.deps.db.query(`update "user" set news_consent = $2, news_consent_at = now(), news_consent_text = $3 where id = $1`, [id, consent, `news-1.${language}`])
    ids.push(id)
  }
  return ids
}

const deliveries = (h: Harness) =>
  h.deps.db.query<{ user_id: string; status: string; attempts: number }>('select user_id, status, attempts from announcement_delivery order by user_id')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the announcements routes of the review app (#185)', () => {
  it('are routes that do not exist without the write token, and to the token that only reads', async () => {
    for (const h of [harness(), harness({ config: { feedbackReadToken: readToken } })]) {
      expect((await ask(h, '')).status).toBe(404)
      expect((await ask(h, '/save', { kind: 'service', texts: { en } })).status).toBe(404)
    }
    const h = withToken()
    for (const authorization of [null, `Bearer ${readToken}`, 'Bearer wrong']) {
      expect((await ask(h, '', undefined, authorization)).status).toBe(404)
      for (const path of ['/save', '/delete', '/preview', '/test', '/send', '/stop', '/resume']) expect((await ask(h, path, { id: 1 }, authorization)).status).toBe(404)
    }
    expect(await h.deps.db.query('select id from announcement')).toEqual([])
  })

  it('keeps a draft, and counts each change of it as a new version', async () => {
    const h = withToken()
    const a = await draft(h, 'service', { en, bg })
    expect(a).toMatchObject({ kind: 'service', status: 'draft', version: 1, testedVersion: null, texts: { en, bg }, recipients: 0, sent: 0, failed: 0, skipped: 0, queued: 0, held: null, startedAt: null })
    const changed = await ask(h, '/save', { id: a.id, kind: 'news', texts: { en: { subject: ' New ', body: 'One\r\nTwo' } } })
    expect(changed.body.announcement).toMatchObject({ id: a.id, kind: 'news', version: 2, texts: { en: { subject: 'New', body: 'One\nTwo' } } })
    expect((await ask(h, '')).body.announcements).toHaveLength(1)
    expect((await ask(h, '/save', { id: a.id + 1, kind: 'news', texts: { en } })).status).toBe(404)
  })

  it('refuses what is not an announcement: a kind it does not have, texts without English, a subject of two lines', async () => {
    const h = withToken()
    for (const body of [{ kind: 'marketing', texts: { en } }, { kind: 'service', texts: { bg } }, { kind: 'service' }, { kind: 'service', texts: { en: { subject: 'One\nBcc: x@example.com', body: 'b' } } }, { id: 'x', kind: 'service', texts: { en } }]) {
      expect((await ask(h, '/save', body)).status).toBe(400)
    }
    expect((await ask(h, '')).body.announcements).toEqual([])
  })

  it('lists what there is, newest first, with the limits it works under and nothing of an account', async () => {
    const h = withToken({ announcementMailsPerDay: 7 })
    const [userId] = await accounts(h, 1)
    const first = await start(h, await tested(h))
    await run(h)
    const second = await draft(h, 'news')
    const reply = await ask(h, '')
    expect(reply.status).toBe(200)
    expect(reply.headers.get('cache-control')).toBe('no-store')
    expect((reply.body.announcements as View[]).map((a) => a.id)).toEqual([second.id, first.id])
    // The test send and the one mail.
    expect(reply.body.limits).toEqual({ perDay: 7, sentToday: 2, batch: ANNOUNCEMENT_BATCH })
    const text = JSON.stringify(reply.body)
    expect(text).not.toContain(userId)
    expect(text).not.toContain('@example.com')
  })

  it('deletes a draft, and nothing that was sent', async () => {
    const h = withToken()
    await accounts(h, 1)
    const a = await draft(h)
    expect((await ask(h, '/delete', { id: a.id })).body).toEqual({ deleted: true })
    expect((await ask(h, '/delete', { id: a.id })).status).toBe(404)
    const sending = await start(h, await tested(h))
    expect((await ask(h, '/delete', { id: sending.id })).status).toBe(409)
    expect((await ask(h, '')).body.announcements).toHaveLength(1)
  })

  it('previews each language as it is mailed, and says how many accounts get which', async () => {
    const h = withToken()
    const [inBulgarian, inGerman] = await accounts(h, 3)
    await h.deps.db.query(`update "user" set news_consent = 'given', news_consent_at = now(), news_consent_text = 'news-1.bg' where id = $1`, [inBulgarian])
    await h.deps.db.query(`update "user" set news_consent = 'withdrawn', news_consent_at = now(), news_consent_text = 'news-1.de' where id = $1`, [inGerman])
    const service = await draft(h, 'service', { en, bg })
    const reply = await ask(h, '/preview', { id: service.id })
    expect(reply.status).toBe(200)
    // German has no text: that account gets the English one.
    expect(reply.body).toMatchObject({ version: 1, kind: 'service', recipients: 3, byLanguage: { bg: 1, en: 2 } })
    expect(reply.body.mails.map((m: { language: string }) => m.language)).toEqual(['bg', 'en'])
    expect(reply.body.mails[1]).toMatchObject({ subject: en.subject, text: expect.stringContaining('You are receiving this notice because you have a Wordado account.') })
    expect(reply.body.mails[0].text).toContain('Получавате това съобщение')
    // News: the one account that consented, and the link in the text.
    const news = await draft(h, 'news', { en })
    const preview = (await ask(h, '/preview', { id: news.id })).body
    expect(preview).toMatchObject({ kind: 'news', recipients: 1, byLanguage: { en: 1 } })
    expect(preview.mails[0].text).toContain('/v1/news/unsubscribe?t=')
    expect(h.announcements).toEqual([])
  })
})

describe('the test send (#185)', () => {
  it('mails every language of this version to one address, and only then can the version be sent', async () => {
    const h = withToken()
    const a = await draft(h, 'news', { en, bg })
    const reply = await ask(h, '/test', { id: a.id, version: 1, email: ` ${OWNER} ` })
    expect(reply.status).toBe(200)
    expect(reply.body).toMatchObject({ mails: 2, announcement: { testedVersion: 1 } })
    expect(h.announcements.map((m) => [m.to, m.subject])).toEqual([
      [OWNER, `[Test] ${bg.subject}`],
      [OWNER, `[Test] ${en.subject}`],
    ])
    for (const mail of h.announcements) {
      expect(mail.replyTo).toBe(CONTACT_ADDRESS)
      expect(mail.headers['List-Unsubscribe']).toMatch(/^<http:\/\/localhost:8787\/v1\/news\/unsubscribe\?t=[\w.-]+&l=(bg|en)>$/)
      expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    }
    expect(h.announcements[1]!.text).toContain(en.body)
  })

  it('keeps the address nowhere: not in the database, not in a log', async () => {
    const h = withToken()
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const a = await draft(h)
    await ask(h, '/test', { id: a.id, version: 1, email: OWNER })
    const kept = await h.deps.db.query(`select row_to_json(a)::text as row from announcement a union all select row_to_json(d)::text from announcement_mail_day d`)
    expect(JSON.stringify(kept)).not.toContain(OWNER)
    expect(JSON.stringify(log.mock.calls)).not.toContain(OWNER)
  })

  it('is of one version: a change after it needs a test send again', async () => {
    const h = withToken()
    await accounts(h, 1)
    const a = await tested(h)
    const changed = (await ask(h, '/save', { id: a.id, kind: 'service', texts: { en: { ...en, body: 'Another text.' } } })).body.announcement as View
    expect(changed).toMatchObject({ version: 2, testedVersion: 1 })
    expect((await ask(h, '/send', { id: a.id, version: 2, kind: 'service', recipients: 1 })).body).toEqual({ error: 'untested' })
    // A test send of the version that is no more is refused too.
    expect((await ask(h, '/test', { id: a.id, version: 1, email: OWNER })).body).toEqual({ error: 'stale' })
    expect(h.announcements).toEqual([])
  })

  it('refuses what is no address, and does not count a mail the provider did not take', async () => {
    const h = withToken()
    const a = await draft(h)
    for (const email of ['owner', '', 7, 'a@b\nBcc: c@d', 'two@example.com, three@example.com']) expect((await ask(h, '/test', { id: a.id, version: 1, email })).status).toBe(400)
    h.mailFailure = () => new MailNotSent('busy', 'Resend did not send the announcement mail: 500')
    const reply = await ask(h, '/test', { id: a.id, version: 1, email: OWNER })
    expect(reply.status).toBe(502)
    expect(reply.body).toEqual({ error: 'mail_not_sent', reason: 'busy' })
    expect((await one(h, a.id)).testedVersion).toBeNull()
  })
})

describe('pressing send (#185)', () => {
  it('needs the version tested, and the kind and the count the owner was shown', async () => {
    const h = withToken()
    await accounts(h, 3)
    const untested = await draft(h)
    expect((await ask(h, '/send', { id: untested.id, version: 1, kind: 'service', recipients: 3 })).body).toEqual({ error: 'untested' })
    const a = await tested(h)
    for (const body of [{ id: a.id }, { id: a.id, version: 1, kind: 'service' }, { id: a.id, version: 1, kind: 'service', recipients: '3' }, { id: a.id, version: 1, recipients: 3 }]) {
      expect((await ask(h, '/send', body)).status).toBe(400)
    }
    expect((await ask(h, '/send', { id: a.id, version: 2, kind: 'service', recipients: 3 })).body).toEqual({ error: 'stale' })
    expect((await ask(h, '/send', { id: a.id, version: 1, kind: 'news', recipients: 3 })).body).toEqual({ error: 'stale' })
    // An account more than was shown: the count is given again, and nothing starts.
    const wrong = await ask(h, '/send', { id: a.id, version: 1, kind: 'service', recipients: 2 })
    expect(wrong.status).toBe(409)
    expect(wrong.body).toEqual({ error: 'changed', recipients: 3 })
    expect(await deliveries(h)).toEqual([])
    expect((await one(h, a.id)).status).toBe('draft')
    const reply = await ask(h, '/send', { id: a.id, version: 1, kind: 'service', recipients: 3 })
    expect(reply.status).toBe(200)
    expect(reply.body.announcement).toMatchObject({ status: 'sending', recipients: 3, queued: 3, sent: 0, startedAt: h.clock.now })
    // The press mails nobody: the cron does.
    expect(h.announcements).toEqual([])
  })

  it('happens once: an announcement being sent cannot be sent again, changed or tested', async () => {
    const h = withToken()
    await accounts(h, 2)
    const a = await start(h, await tested(h))
    expect((await ask(h, '/send', { id: a.id, version: 1, kind: 'service', recipients: 2 })).body).toEqual({ error: 'not_draft' })
    expect((await ask(h, '/save', { id: a.id, kind: 'service', texts: { en: { subject: 'Other', body: 'Other' } } })).body).toEqual({ error: 'not_draft' })
    expect((await ask(h, '/test', { id: a.id, version: 1, email: OWNER })).body).toEqual({ error: 'not_draft' })
    await run(h)
    expect((await one(h, a.id)).status).toBe('sent')
    expect((await ask(h, '/send', { id: a.id, version: 1, kind: 'service', recipients: 2 })).body).toEqual({ error: 'not_draft' })
    expect((await ask(h, '/resume', { id: a.id })).body).toEqual({ error: 'not_stopped' })
    expect(h.announcements).toHaveLength(2)
    expect(await deliveries(h)).toHaveLength(2)
  })

  it('starts once when pressed twice at the same moment', async () => {
    const h = withToken()
    await accounts(h, 2)
    const a = await tested(h)
    const body = { id: a.id, version: 1, kind: 'service', recipients: 2 }
    const replies = await Promise.all([ask(h, '/send', body), ask(h, '/send', body)])
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await deliveries(h)).toHaveLength(2)
  })

  it('sends to nobody when there is nobody', async () => {
    const h = withToken()
    await accounts(h, 1, 'withdrawn')
    const a = await tested(h, 'news')
    expect((await ask(h, '/send', { id: a.id, version: 1, kind: 'news', recipients: 0 })).body).toEqual({ error: 'nobody' })
  })

  it('fixes who gets it: an account made after the press is not among them', async () => {
    const h = withToken()
    const before = await accounts(h, 2)
    const a = await start(h, await tested(h))
    const [after] = await accounts(h, 1)
    await run(h)
    expect((await deliveries(h)).map((d) => d.user_id)).toEqual([...before].sort())
    expect(h.announcements.map((m) => m.to).sort()).toEqual(before.map((id) => `${id}@example.com`).sort())
    expect(h.announcements.map((m) => m.to)).not.toContain(`${after}@example.com`)
    expect(await one(h, a.id)).toMatchObject({ status: 'sent', recipients: 2, sent: 2, queued: 0, finishedAt: h.clock.now })
  })
})

describe('the two kinds (#185)', () => {
  it('a service notice goes to every account, whatever it said about news, with no way to unsubscribe', async () => {
    const h = withToken()
    await accounts(h, 1, 'none')
    await accounts(h, 1, 'given')
    await accounts(h, 1, 'withdrawn')
    await start(h, await tested(h, 'service'))
    await run(h)
    expect(h.announcements).toHaveLength(3)
    for (const mail of h.announcements) {
      expect(mail.headers).toEqual({})
      expect(mail.text).not.toContain('unsubscribe')
      expect(mail.text).toContain('Notices about the service itself go to every account holder.')
      expect(mail.replyTo).toBe(CONTACT_ADDRESS)
    }
  })

  it('news goes only to the accounts that consented, each with its own link', async () => {
    const h = withToken()
    await accounts(h, 2, 'none')
    await accounts(h, 2, 'withdrawn')
    const consented = await accounts(h, 2, 'given')
    const a = await start(h, await tested(h, 'news'))
    expect(a.recipients).toBe(2)
    await run(h)
    expect(h.announcements.map((m) => m.to).sort()).toEqual(consented.map((id) => `${id}@example.com`).sort())
    const links = h.announcements.map((m) => m.headers['List-Unsubscribe'])
    expect(new Set(links).size).toBe(2)
    for (const mail of h.announcements) {
      expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
      expect(mail.text).toContain(mail.headers['List-Unsubscribe']!.slice(1, -1))
    }
  })

  it('asks again when each news mail goes: who withdrew since the press gets nothing', async () => {
    const h = withToken()
    const [stays, leaves] = await accounts(h, 2, 'given')
    const a = await start(h, await tested(h, 'news'))
    await h.deps.db.query(`update "user" set news_consent = 'withdrawn', news_consent_at = now() where id = $1`, [leaves])
    expect(await run(h)).toMatchObject({ sent: 1, skipped: 1, failed: 0 })
    expect(h.announcements.map((m) => m.to)).toEqual([`${stays}@example.com`])
    expect(await one(h, a.id)).toMatchObject({ status: 'sent', recipients: 2, sent: 1, skipped: 1, queued: 0 })
    // Consenting again later brings no mail of an announcement that is done.
    await h.deps.db.query(`update "user" set news_consent = 'given' where id = $1`, [leaves])
    await run(h)
    expect(h.announcements).toHaveLength(1)
  })
})

describe('the language of the mail (#185)', () => {
  const all = { en, bg, de: { subject: 'Hallo', body: 'Text' }, es: { subject: 'Hola', body: 'Texto' } }
  const subjectOf = (h: Harness, id: string) => h.announcements.find((m) => m.to === `${id}@example.com`)?.subject

  it('is the one the account’s device reminds in, else the one it read the news question in, else its native language, else English', async () => {
    const h = withToken()
    const [push, consent, l1, unknown, both] = await accounts(h, 5)
    const subscribe = (id: string, language: string, at: number) =>
      h.deps.db.query(
        `insert into push_subscription (endpoint, user_id, p256dh, auth, reminder_minute, tz_offset_min, language, created_at) values ($1, $2, 'k', 'a', 600, 0, $3, $4)`,
        [`https://push.example/${id}/${at}`, id, language, at],
      )
    await subscribe(push!, 'de', 1)
    // The newest device speaks for the account.
    await subscribe(both!, 'bg', 1)
    await subscribe(both!, 'de', 2)
    await h.deps.db.query(`update "user" set news_consent = 'withdrawn', news_consent_at = now(), news_consent_text = 'news-1.es' where id = any($1)`, [[consent, both]])
    for (const id of [l1, consent]) {
      await h.deps.db.query(`insert into document (user_id, type, key, class, version, fields, field_versions) values ($1, 'settings', '', 'versioned', 1, '{"l1": "bg"}', '{}')`, [id])
    }
    await start(h, await tested(h, 'service', all))
    await run(h)
    expect(subjectOf(h, push!)).toBe('Hallo')
    expect(subjectOf(h, consent!)).toBe('Hola')
    expect(subjectOf(h, l1!)).toBe(bg.subject)
    expect(subjectOf(h, unknown!)).toBe(en.subject)
    expect(subjectOf(h, both!)).toBe('Hallo')
  })

  it('falls back to English where the announcement has no text in the account’s language', async () => {
    const h = withToken()
    const [german, bulgarian] = await accounts(h, 2)
    await h.deps.db.query(`update "user" set news_consent = 'given', news_consent_at = now(), news_consent_text = 'news-1.de' where id = $1`, [german])
    await h.deps.db.query(`update "user" set news_consent = 'given', news_consent_at = now(), news_consent_text = 'news-1.bg' where id = $1`, [bulgarian])
    await start(h, await tested(h, 'news', { en, bg }))
    await run(h)
    expect(subjectOf(h, german!)).toBe(en.subject)
    expect(subjectOf(h, bulgarian!)).toBe(bg.subject)
    // The link names the language of the mail, for the page it opens.
    expect(h.announcements.find((m) => m.to === `${german}@example.com`)!.headers['List-Unsubscribe']).toMatch(/&l=en>$/)
    expect(h.announcements.find((m) => m.to === `${bulgarian}@example.com`)!.headers['List-Unsubscribe']).toMatch(/&l=bg>$/)
  })
})

describe('the cron’s step that sends (#185)', () => {
  it('does nothing, and asks the mailer nothing, while no announcement is being sent', async () => {
    const h = withToken()
    await accounts(h, 2)
    await tested(h)
    expect(await run(h)).toEqual({ sent: 0, failed: 0, skipped: 0, held: null })
    expect(h.announcements).toEqual([])
  })

  it('sends a bounded batch a run, waits between two mails, and goes on where it stopped without mailing anyone twice', async () => {
    const h = withToken({ announcementMailsPerDay: 1000 })
    const ids = await accounts(h, ANNOUNCEMENT_BATCH + 3)
    const a = await start(h, await tested(h))
    const pauses: number[] = []
    expect(await sendAnnouncements(h.deps, async (ms) => void pauses.push(ms))).toEqual({ sent: ANNOUNCEMENT_BATCH, failed: 0, skipped: 0, held: null })
    expect(pauses).toEqual(Array.from({ length: ANNOUNCEMENT_BATCH - 1 }, () => ANNOUNCEMENT_SEND_INTERVAL_MS))
    expect(await one(h, a.id)).toMatchObject({ status: 'sending', sent: ANNOUNCEMENT_BATCH, queued: 3, finishedAt: null })
    h.clock.advance(15 * 60_000)
    expect(await run(h)).toMatchObject({ sent: 3 })
    expect(await one(h, a.id)).toMatchObject({ status: 'sent', sent: ANNOUNCEMENT_BATCH + 3, queued: 0, finishedAt: h.clock.now })
    expect(await run(h)).toMatchObject({ sent: 0 })
    expect(h.announcements.map((m) => m.to).sort()).toEqual(ids.map((id) => `${id}@example.com`).sort())
    // Each mail under a key of its own, which names the announcement and nothing of the account.
    const keys = h.announcements.map((m) => m.idempotencyKey)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(key).toMatch(new RegExp(`^announcement/${a.id}/[0-9a-f-]{36}$`))
    for (const id of ids) expect(keys.join(' ')).not.toContain(id)
  })

  it('is a step of the scheduled run', async () => {
    const h = withToken()
    await accounts(h, 1)
    const a = await start(h, await tested(h))
    await runScheduled(h.deps)
    expect(h.announcements).toHaveLength(1)
    expect((await one(h, a.id)).status).toBe('sent')
  })

  it('holds a day’s mails to the allowance, counts the test send in it, and goes on the next UTC day', async () => {
    const h = withToken({ announcementMailsPerDay: 4 })
    h.clock.now = Date.UTC(2026, 9, 12, 10)
    await accounts(h, 6)
    const a = await start(h, await tested(h))
    expect(await run(h)).toEqual({ sent: 3, failed: 0, skipped: 0, held: 'day' })
    expect(await one(h, a.id)).toMatchObject({ status: 'sending', sent: 3, queued: 3, held: { reason: 'day', at: h.clock.now } })
    h.clock.advance(15 * 60_000)
    expect(await run(h)).toEqual({ sent: 0, failed: 0, skipped: 0, held: 'day' })
    h.clock.now = Date.UTC(2026, 9, 13, 0, 1)
    expect(await run(h)).toEqual({ sent: 3, failed: 0, skipped: 0, held: null })
    expect(await one(h, a.id)).toMatchObject({ status: 'sent', sent: 6, queued: 0, held: null })
  })

  it('sends none on a day whose allowance is 0', async () => {
    const h = withToken({ announcementMailsPerDay: 0 })
    await accounts(h, 1)
    await start(h, await tested(h))
    expect(await run(h)).toMatchObject({ sent: 0, held: 'day' })
    expect(h.announcements).toEqual([])
  })

  it('counts a mail the provider will never take as failed, and goes on to the others', async () => {
    const h = withToken()
    const [bad] = await accounts(h, 3)
    const a = await start(h, await tested(h))
    h.mailFailure = (mail) => (mail.to === `${bad}@example.com` ? new MailNotSent('refused', 'Resend did not send the announcement mail: 422') : null)
    expect(await run(h)).toEqual({ sent: 2, failed: 1, skipped: 0, held: null })
    expect(await one(h, a.id)).toMatchObject({ status: 'sent', sent: 2, failed: 1, queued: 0 })
    h.mailFailure = null
    await run(h)
    expect(h.announcements).toHaveLength(2)
  })

  it('stops the run when the provider takes nothing now, holds that against no account, and sends at a later run', async () => {
    const h = withToken()
    await accounts(h, 3)
    const a = await start(h, await tested(h))
    const tried: string[] = []
    h.mailFailure = (mail) => {
      tried.push(mail.idempotencyKey)
      return new MailNotSent('busy', 'Resend did not send the announcement mail: 429')
    }
    for (let i = 0; i < MAX_ANNOUNCEMENT_ATTEMPTS + 2; i += 1) {
      expect(await run(h)).toEqual({ sent: 0, failed: 0, skipped: 0, held: 'busy' })
      h.clock.advance(15 * 60_000)
    }
    // One try a run, and nobody given up on.
    expect(tried).toHaveLength(MAX_ANNOUNCEMENT_ATTEMPTS + 2)
    expect(await one(h, a.id)).toMatchObject({ status: 'sending', sent: 0, failed: 0, queued: 3, held: { reason: 'busy' } })
    expect((await deliveries(h)).map((d) => d.attempts)).toEqual([0, 0, 0])
    h.mailFailure = null
    expect(await run(h)).toEqual({ sent: 3, failed: 0, skipped: 0, held: null })
    expect(await one(h, a.id)).toMatchObject({ status: 'sent', held: null })
  })

  it('stops for the day when the provider says its allowance is used up', async () => {
    const h = withToken()
    h.clock.now = Date.UTC(2026, 9, 12, 10)
    await accounts(h, 2)
    const a = await start(h, await tested(h))
    let asked = 0
    h.mailFailure = () => {
      asked += 1
      return new MailNotSent('quota', 'Resend did not send the announcement mail: 429')
    }
    expect(await run(h)).toEqual({ sent: 0, failed: 0, skipped: 0, held: 'quota' })
    h.clock.advance(15 * 60_000)
    // Not asked again today.
    expect(await run(h)).toMatchObject({ sent: 0, held: 'day' })
    expect(asked).toBe(1)
    expect(await one(h, a.id)).toMatchObject({ queued: 2, held: { reason: 'day' } })
    h.mailFailure = null
    h.clock.now = Date.UTC(2026, 9, 13, 0, 1)
    expect(await run(h)).toMatchObject({ sent: 2, held: null })
  })

  it('asks again with the same key when it is not known whether a mail went, and not before the first try has had its time', async () => {
    const h = withToken()
    await accounts(h, 1)
    const a = await start(h, await tested(h))
    const keys: string[] = []
    h.mailFailure = (mail) => {
      keys.push(mail.idempotencyKey)
      return new TypeError('network')
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await run(h)).toEqual({ sent: 0, failed: 0, skipped: 0, held: 'busy' })
    expect(JSON.stringify(error.mock.calls)).not.toContain('@example.com')
    // A run that comes while the first try may still be answered leaves the mail alone.
    h.clock.advance(ANNOUNCEMENT_CLAIM_MS - 1)
    await run(h)
    expect(keys).toHaveLength(1)
    h.clock.advance(1)
    h.mailFailure = (mail) => {
      keys.push(mail.idempotencyKey)
      return null
    }
    expect(await run(h)).toMatchObject({ sent: 1 })
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
    expect(await one(h, a.id)).toMatchObject({ status: 'sent', sent: 1, failed: 0 })
  })

  it('keeps the key, too, when the provider takes nothing at a later try: the first may have gone', async () => {
    const h = withToken()
    await accounts(h, 1)
    await start(h, await tested(h))
    const keys: string[] = []
    const answers: (Error | null)[] = [new TypeError('network'), new MailNotSent('busy', '503'), null]
    h.mailFailure = (mail) => {
      keys.push(mail.idempotencyKey)
      return answers[keys.length - 1] ?? null
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (let i = 0; i < 3; i += 1) {
      await run(h)
      h.clock.advance(ANNOUNCEMENT_CLAIM_MS)
    }
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(1)
    expect(h.announcements).toHaveLength(1)
  })

  it('gives a mail up as failed after so many tries with no answer, or once the key no longer holds, rather than risk a second mail', async () => {
    const h = withToken()
    const [first] = await accounts(h, 1)
    const a = await start(h, await tested(h))
    let tries = 0
    h.mailFailure = () => {
      tries += 1
      return new TypeError('network')
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (let i = 0; i < MAX_ANNOUNCEMENT_ATTEMPTS + 3; i += 1) {
      await run(h)
      h.clock.advance(ANNOUNCEMENT_CLAIM_MS)
    }
    expect(tries).toBe(MAX_ANNOUNCEMENT_ATTEMPTS)
    expect(await one(h, a.id)).toMatchObject({ status: 'sent', sent: 0, failed: 1, queued: 0 })
    expect(await deliveries(h)).toEqual([{ user_id: first, status: 'failed', attempts: MAX_ANNOUNCEMENT_ATTEMPTS }])

    // One try, then a stop of more than the time the provider keeps a key for: resumed, the mail is not tried again.
    await accounts(h, 1)
    await h.deps.db.query('delete from "user" where id = $1', [first])
    const failing = h.mailFailure
    h.mailFailure = null
    const b = await start(h, await tested(h))
    h.mailFailure = failing
    tries = 0
    await run(h)
    await ask(h, '/stop', { id: b.id })
    h.clock.advance(ANNOUNCEMENT_KEY_WINDOW_MS)
    await ask(h, '/resume', { id: b.id })
    await run(h)
    expect(tries).toBe(1)
    expect(await one(h, b.id)).toMatchObject({ status: 'sent', sent: 0, failed: 1 })
  })

  it('logs counts and nothing of an account', async () => {
    const h = withToken()
    const ids = await accounts(h, 2)
    await start(h, await tested(h))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await run(h)
    expect(log.mock.calls).toEqual([['announcements: 2 sent, 0 failed, 0 skipped']])
    for (const id of ids) expect(JSON.stringify(log.mock.calls)).not.toContain(id)
  })
})

describe('stopping a send (#185)', () => {
  it('stops it where it is, and resumes it without a second mail to anyone', async () => {
    const h = withToken({ announcementMailsPerDay: 1000 })
    await accounts(h, ANNOUNCEMENT_BATCH + 2)
    const a = await start(h, await tested(h))
    await run(h)
    const stopped = await ask(h, '/stop', { id: a.id })
    expect(stopped.body.announcement).toMatchObject({ status: 'stopped', sent: ANNOUNCEMENT_BATCH, queued: 2, stoppedAt: h.clock.now })
    expect(await run(h)).toEqual({ sent: 0, failed: 0, skipped: 0, held: null })
    expect(h.announcements).toHaveLength(ANNOUNCEMENT_BATCH)
    // Stopped, it is still not a draft.
    expect((await ask(h, '/save', { id: a.id, kind: 'service', texts: { en } })).body).toEqual({ error: 'not_draft' })
    expect((await ask(h, '/stop', { id: a.id })).body).toEqual({ error: 'not_sending' })
    const resumed = await ask(h, '/resume', { id: a.id })
    expect(resumed.body.announcement).toMatchObject({ status: 'sending', stoppedAt: null })
    await run(h)
    expect(h.announcements).toHaveLength(ANNOUNCEMENT_BATCH + 2)
    expect(new Set(h.announcements.map((m) => m.to)).size).toBe(ANNOUNCEMENT_BATCH + 2)
    expect((await one(h, a.id)).status).toBe('sent')
  })
})

describe('an account that is deleted (#185)', () => {
  it('takes its rows with it, by the learner’s own deletion and by the sweep alike, and the counts stay', async () => {
    const h = withToken()
    h.clock.now = Date.UTC(2026, 9, 12, 10)
    const leaving = await h.signIn()
    const [swept, staying] = await accounts(h, 2)
    await h.deps.db.query('update "user" set last_sign_in_at = $2 where id = $1', [swept, new Date(h.clock.now - INACTIVE_ACCOUNT_MS - DAY)])
    const done = await start(h, await tested(h))
    await run(h)
    const waiting = await start(h, await tested(h))
    expect(await deliveries(h)).toHaveLength(6)

    expect((await leaving.del('/v1/account', { confirm: true })).status).toBe(200)
    expect(await sweepInactiveAccounts(h.deps)).toBe(1)
    expect((await deliveries(h)).map((d) => d.user_id)).toEqual([staying, staying])
    expect(await h.deps.db.query('select 1 from announcement_delivery where user_id = any($1)', [[leaving.userId, swept]])).toEqual([])
    // What was sent stays counted; what was still waiting is simply no longer there.
    expect(await one(h, done.id)).toMatchObject({ recipients: 3, sent: 3, queued: 0 })
    expect(await one(h, waiting.id)).toMatchObject({ recipients: 3, sent: 0, queued: 1 })
    h.announcements.length = 0
    await run(h)
    expect(h.announcements.map((m) => m.to)).toEqual([`${staying}@example.com`])
    expect(await one(h, waiting.id)).toMatchObject({ status: 'sent', recipients: 3, sent: 1, queued: 0 })
    // And the provider's deletion by hand, which is the same deletion.
    expect(await deleteAccount(h.deps.db, staying!)).toBe(true)
    expect(await deliveries(h)).toEqual([])
    expect((await ask(h, '')).body.announcements).toHaveLength(2)
  })
})
