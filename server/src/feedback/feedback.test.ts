import { MAX_FEEDBACK_MESSAGE_LENGTH } from '@wordado/core'
import { describe, expect, it, vi } from 'vitest'
import { BASE_URL, harness, type Harness, type Reply } from '../../test/harness'
import { runScheduled } from '../jobs/scheduled'
import { FEEDBACK_PER_CLIENT_PER_HOUR, FEEDBACK_PER_DAY, FEEDBACK_SEND_RETENTION_MS, feedbackClient, pruneFeedbackSends } from './limit'
import { FEEDBACK_MAIL_MAX, mailNewFeedback } from './mail'

const HOUR = 3_600_000
const DAY = 86_400_000

const feedback = {
  kind: 'bug',
  message: 'The path does not open.',
  email: '',
  appVersion: 'B3kq9xZa',
  corpusVersion: 'bg 6',
  language: 'bg',
  screen: '/path',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
}

/** A message from someone who is not signed in, at `ip`. */
function send(h: Harness, body: unknown, ip = '10.30.0.1', headers: Record<string, string> = {}): Promise<Reply> {
  return h.request('/v1/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE_URL, 'cf-connecting-ip': ip, ...headers },
    body: JSON.stringify(body),
  })
}

const stored = (h: Harness) =>
  h.deps.db.query<Record<string, unknown>>(
    'select user_id, kind, message, contact_email, app_version, corpus_version, user_agent, language, screen, received_at, mailed_at from feedback order by id',
  )

/** `count` messages waiting for the mail, received a minute apart from `from`. */
async function seedFeedback(h: Harness, count: number, from: number): Promise<void> {
  await h.deps.db.query(
    `insert into feedback (kind, message, app_version, corpus_version, user_agent, language, screen, received_at)
     select 'idea', 'idea ' || n, 'B3kq9xZa', 'bg 6', 'Mozilla/5.0', 'bg', '/', $2::bigint + n * 60000 from generate_series(1, $1) as n`,
    [count, from],
  )
}

describe('POST /v1/feedback (spec §8.12)', () => {
  it('keeps a message from someone who is not signed in, with what was sent beside it', async () => {
    const h = harness()
    const reply = await send(h, { ...feedback, message: '  The path does not open. ', email: ' ana@example.com ' })
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ ok: true })
    expect(await stored(h)).toEqual([
      {
        user_id: null,
        kind: 'bug',
        message: 'The path does not open.',
        contact_email: 'ana@example.com',
        app_version: 'B3kq9xZa',
        corpus_version: 'bg 6',
        user_agent: 'Mozilla/5.0 (X11; Linux x86_64)',
        language: 'bg',
        screen: '/path',
        received_at: h.clock.now,
        mailed_at: null,
      },
    ])
  })

  it('attaches the account of a signed-in sender, unless the client names another learner', async () => {
    const h = harness()
    const s = await h.signIn()
    expect((await s.post('/v1/feedback', { ...feedback, kind: 'idea' })).status).toBe(200)
    expect((await s.post('/v1/feedback', feedback, { 'x-wordado-user': s.userId })).status).toBe(200)
    expect((await s.post('/v1/feedback', feedback, { 'x-wordado-user': 'someone-else' })).status).toBe(200)
    expect((await stored(h)).map((row) => row['user_id'])).toEqual([s.userId, s.userId, null])
  })

  it('refuses a body that breaks a rule, and one that is not JSON', async () => {
    const h = harness()
    for (const body of [
      { ...feedback, kind: 'praise' },
      { ...feedback, message: ' ' },
      { ...feedback, message: 'x'.repeat(MAX_FEEDBACK_MESSAGE_LENGTH + 1) },
      { ...feedback, email: 'not an address' },
      { ...feedback, screen: '/practice?unit=a1-01' },
      { ...feedback, language: 'Bulgarian' },
      'feedback',
    ]) {
      const reply = await send(h, body)
      expect(reply.status).toBe(400)
      expect(reply.body.error).toBe('invalid')
    }
    const text = await h.request('/v1/feedback', { method: 'POST', headers: { 'content-type': 'text/plain', origin: BASE_URL }, body: JSON.stringify(feedback) })
    expect(text.status).toBe(400)
    expect(await stored(h)).toEqual([])
    expect(await h.deps.db.query('select id from feedback_send')).toEqual([])
  })

  it('answers a body with the hidden field filled in like any other, and keeps nothing', async () => {
    const h = harness()
    const reply = await send(h, { ...feedback, website: 'https://example.com' })
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ ok: true })
    // Even one that would have been refused: a program learns nothing from the answer.
    expect((await send(h, { kind: 'praise', website: 'x' })).status).toBe(200)
    expect(await stored(h)).toEqual([])
    expect(await h.deps.db.query('select id from feedback_send')).toEqual([])
  })

  it(`keeps at most ${FEEDBACK_PER_CLIENT_PER_HOUR} messages an hour from one address`, async () => {
    const h = harness()
    const statuses: number[] = []
    for (let i = 0; i <= FEEDBACK_PER_CLIENT_PER_HOUR; i += 1) statuses.push((await send(h, feedback)).status)
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
    const refused = await send(h, feedback)
    expect(refused.status).toBe(429)
    expect(refused.body).toEqual({ error: 'feedback_limit' })
    expect(await stored(h)).toHaveLength(FEEDBACK_PER_CLIENT_PER_HOUR)
    expect((await send(h, feedback, '10.30.0.2')).status).toBe(200)
    h.clock.advance(HOUR)
    expect((await send(h, feedback)).status).toBe(200)
  })

  it(`keeps at most ${FEEDBACK_PER_DAY} messages in a UTC day in all`, async () => {
    const h = harness()
    const startOfDay = Math.floor(h.clock.now / DAY) * DAY
    const seed = (count: number, sentAt: number) =>
      h.deps.db.query(`insert into feedback_send (client, sent_at) select 'seed-' || n, $2 from generate_series(1, $1) as n`, [count, sentAt])
    await seed(FEEDBACK_PER_DAY, startOfDay - 1)
    expect((await send(h, feedback)).status).toBe(200)
    await seed(FEEDBACK_PER_DAY - 1, startOfDay)
    expect((await send(h, feedback, '10.30.0.2')).status).toBe(429)
    expect(await stored(h)).toHaveLength(1)
    h.clock.now = startOfDay + DAY
    expect((await send(h, feedback, '10.30.0.2')).status).toBe(200)
  })

  it('stores a keyed hash of the address, never the address', async () => {
    const h = harness()
    await send(h, feedback, '203.0.113.7')
    const [row] = await h.deps.db.query<{ client: string }>('select client from feedback_send')
    expect(row?.client).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.client).toBe(await feedbackClient(h.deps.config.authSecret, '203.0.113.7'))
    expect(row?.client).not.toBe(await feedbackClient('another-secret', '203.0.113.7'))
    expect(row?.client).not.toBe(await feedbackClient(h.deps.config.authSecret, '203.0.113.8'))
    const tables = await h.deps.db.query<{ name: string }>(`select tablename as name from pg_tables where schemaname = 'public'`)
    for (const { name } of tables) {
      expect(await h.deps.db.query(`select 1 from "${name}" as t where t::text like '%203.0.113.7%'`)).toEqual([])
    }
  })

  it('is not open to other origins: no CORS answer, and a form post from elsewhere is refused', async () => {
    const h = harness({ config: { trustedOrigins: ['https://trusted.example.com'] } })
    const preflight = await h.request('/v1/feedback', {
      method: 'OPTIONS',
      headers: { origin: 'https://elsewhere.example.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
    const form = (origin: string) =>
      h.request('/v1/feedback', { method: 'POST', headers: { 'content-type': 'text/plain', origin }, body: JSON.stringify(feedback) })
    expect((await form('https://elsewhere.example.com')).status).toBe(403)
    // A trusted origin's form post gets past the check, and is then refused for not being JSON.
    expect((await form('https://trusted.example.com')).status).toBe(400)
    expect(await stored(h)).toEqual([])
  })

  it('drops the record of sends a day old, from the cron', async () => {
    const h = harness()
    await send(h, feedback)
    h.clock.advance(FEEDBACK_SEND_RETENTION_MS - 1)
    expect(await pruneFeedbackSends(h.deps)).toBe(0)
    h.clock.advance(2)
    await runScheduled(h.deps)
    expect(await h.deps.db.query('select id from feedback_send')).toEqual([])
    expect(await stored(h)).toHaveLength(1)
  })
})

describe('the daily feedback mail (spec §8.12)', () => {
  const to = 'coordinator@example.com'
  const withMail = () => harness({ config: { feedbackEmail: to } })

  it('sends one mail with the new feedback and marks it mailed', async () => {
    const h = withMail()
    const s = await h.signIn()
    await s.post('/v1/feedback', { ...feedback, email: 'ana@example.com' })
    h.clock.advance(60_000)
    await send(h, { ...feedback, kind: 'idea', message: 'A dark theme.', corpusVersion: '' })
    await runScheduled(h.deps)
    expect(h.feedbackMails).toHaveLength(1)
    const mail = h.feedbackMails[0]!
    expect(mail.to).toBe(to)
    expect(mail.subject).toBe('Wordado feedback: 2 new')
    expect(mail.text).toContain('1. Something isn’t working · ')
    expect(mail.text).toMatch(/· \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\n\nThe path does not open\.\n\nAnswer to: ana@example\.com\nSigned in: yes\n/)
    expect(mail.text).toContain('App: B3kq9xZa · Words: bg 6 · Language: bg · Screen: /path\nBrowser: Mozilla/5.0 (X11; Linux x86_64)')
    expect(mail.text).toContain('2. An idea · ')
    expect(mail.text).toContain('A dark theme.\n\nSigned in: no\nApp: B3kq9xZa · Words: none · ')
    expect(mail.text).not.toContain(s.userId)
    expect(mail.text).not.toContain('more')
    expect((await stored(h)).map((row) => row['mailed_at'])).toEqual([h.clock.now, h.clock.now])
  })

  it('sends at most one mail a UTC day, however often the cron runs', async () => {
    const h = withMail()
    h.clock.now = Math.floor(h.clock.now / DAY) * DAY + HOUR
    await send(h, feedback)
    await runScheduled(h.deps)
    h.clock.advance(15 * 60_000)
    await send(h, { ...feedback, message: 'Later the same day.' })
    await runScheduled(h.deps)
    expect(h.feedbackMails).toHaveLength(1)
    h.clock.advance(DAY)
    await runScheduled(h.deps)
    await runScheduled(h.deps)
    expect(h.feedbackMails).toHaveLength(2)
    expect(h.feedbackMails[1]!.text).toContain('Later the same day.')
    expect(h.feedbackMails[1]!.text).not.toContain('The path does not open.')
    expect(await h.deps.db.query('select count(*)::int as n from feedback_mail')).toEqual([{ n: 1 }])
  })

  it('sends nothing, and uses up no day, while there is nothing new', async () => {
    const h = withMail()
    await runScheduled(h.deps)
    expect(h.feedbackMails).toEqual([])
    expect(await h.deps.db.query('select utc_day from feedback_mail')).toEqual([])
    await send(h, feedback)
    await runScheduled(h.deps)
    expect(h.feedbackMails).toHaveLength(1)
  })

  it(`lists at most ${FEEDBACK_MAIL_MAX}, oldest first, says how many more, and sends those the next day`, async () => {
    const h = withMail()
    await seedFeedback(h, FEEDBACK_MAIL_MAX + 3, h.clock.now - HOUR)
    expect(await mailNewFeedback(h.deps)).toBe(FEEDBACK_MAIL_MAX)
    const first = h.feedbackMails[0]!
    expect(first.subject).toBe(`Wordado feedback: ${FEEDBACK_MAIL_MAX + 3} new`)
    expect(first.text).toContain('\n\nidea 1\n')
    expect(first.text).toContain(`\n\nidea ${FEEDBACK_MAIL_MAX}\n`)
    expect(first.text).not.toContain(`idea ${FEEDBACK_MAIL_MAX + 1}\n`)
    expect(first.text.endsWith('and 3 more')).toBe(true)
    h.clock.advance(DAY)
    expect(await mailNewFeedback(h.deps)).toBe(3)
    expect(h.feedbackMails[1]!.text).toContain(`idea ${FEEDBACK_MAIL_MAX + 1}\n`)
    expect(await h.deps.db.query('select id from feedback where mailed_at is null')).toEqual([])
  })

  it('leaves the feedback waiting when the send fails, and tries again only the next day', async () => {
    const h = withMail()
    await send(h, feedback)
    const failing = vi.spyOn(h.deps.mailer, 'sendFeedback').mockRejectedValueOnce(new Error('Resend refused the email: 500'))
    await expect(runScheduled(h.deps)).rejects.toThrow(AggregateError)
    expect((await stored(h))[0]!['mailed_at']).toBeNull()
    await runScheduled(h.deps)
    expect(failing).toHaveBeenCalledTimes(1)
    expect(h.feedbackMails).toEqual([])
    h.clock.advance(DAY)
    await runScheduled(h.deps)
    expect(h.feedbackMails).toHaveLength(1)
    expect((await stored(h))[0]!['mailed_at']).toBe(h.clock.now)
  })

  it('without FEEDBACK_EMAIL keeps the feedback, mails and marks nothing, and says so in one line', async () => {
    const h = harness()
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await runScheduled(h.deps)
      expect(logged).not.toHaveBeenCalled()
      await send(h, feedback)
      await send(h, feedback)
      await runScheduled(h.deps)
      expect(logged).toHaveBeenCalledTimes(1)
      expect(logged).toHaveBeenCalledWith('feedback: 2 waiting, FEEDBACK_EMAIL is not set')
    } finally {
      logged.mockRestore()
    }
    expect(h.feedbackMails).toEqual([])
    expect((await stored(h)).map((row) => row['mailed_at'])).toEqual([null, null])
    expect(await h.deps.db.query('select utc_day from feedback_mail')).toEqual([])
  })
})
