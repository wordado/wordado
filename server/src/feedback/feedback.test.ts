import { MAX_FEEDBACK_MESSAGE_LENGTH } from '@wordado/core'
import { describe, expect, it, vi } from 'vitest'
import { BASE_URL, harness, type Harness, type Reply } from '../../test/harness'
import { runScheduled } from '../jobs/scheduled'
import { FEEDBACK_PAGE_DEFAULT, FEEDBACK_PAGE_MAX, hasReadToken } from './admin'
import { FEEDBACK_PER_CLIENT_PER_HOUR, FEEDBACK_PER_DAY, FEEDBACK_SEND_RETENTION_MS, feedbackClient, pruneFeedbackSends } from './limit'
import { FEEDBACK_MAIL_MAX, feedbackNotice, mailNewFeedback } from './mail'

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

describe('GET /v1/admin/feedback (spec §8.12)', () => {
  const token = 'r'.repeat(40)
  const withToken = () => harness({ config: { feedbackReadToken: token } })
  /** As the review app's server asks: the token, and no Origin or cookie. */
  const read = (h: Harness, query = '', authorization: string | null = `Bearer ${token}`): Promise<Reply> =>
    h.request(`/v1/admin/feedback${query}`, authorization === null ? {} : { headers: { authorization } })

  it('gives the feedback newest first, with whether the sender was signed in and never who', async () => {
    const h = withToken()
    const s = await h.signIn()
    await s.post('/v1/feedback', { ...feedback, email: 'ana@example.com' })
    const first = h.clock.now
    h.clock.advance(60_000)
    await send(h, { ...feedback, kind: 'idea', message: 'A dark theme.\nAnd bigger letters.', corpusVersion: '' })
    const reply = await read(h)
    expect(reply.status).toBe(200)
    expect(reply.headers.get('cache-control')).toBe('no-store')
    expect(reply.headers.get('access-control-allow-origin')).toBeNull()
    expect(reply.body.nextBefore).toBeNull()
    expect(reply.body.items).toEqual([
      {
        id: expect.any(Number),
        receivedAt: h.clock.now,
        kind: 'idea',
        message: 'A dark theme.\nAnd bigger letters.',
        contactEmail: '',
        signedIn: false,
        appVersion: 'B3kq9xZa',
        corpusVersion: '',
        language: 'bg',
        screen: '/path',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      },
      {
        id: expect.any(Number),
        receivedAt: first,
        kind: 'bug',
        message: 'The path does not open.',
        contactEmail: 'ana@example.com',
        signedIn: true,
        appVersion: 'B3kq9xZa',
        corpusVersion: 'bg 6',
        language: 'bg',
        screen: '/path',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      },
    ])
    expect(JSON.stringify(reply.body)).not.toContain(s.userId)
  })

  it('is a route that does not exist without the token, with a wrong one, or when the secret is not set', async () => {
    const h = withToken()
    await send(h, feedback)
    const unknown = await h.request('/v1/no-such-route')
    expect(unknown.status).toBe(404)
    for (const authorization of [null, '', 'Bearer', 'Bearer ', `Bearer ${token}x`, `Bearer ${token.slice(1)}`, `bearer ${token}`, `Basic ${token}`, token]) {
      const reply = await read(h, '', authorization)
      expect(reply.status).toBe(404)
      expect(reply.body).toEqual(unknown.body)
    }
    // The token in the address is not the token.
    expect((await read(h, `?token=${token}`, null)).status).toBe(404)
    // A signed-in learner is nobody here.
    const s = await h.signIn()
    expect((await s.get('/v1/admin/feedback')).status).toBe(404)
    const closed = harness()
    for (const authorization of [null, `Bearer ${token}`, 'Bearer ', 'Bearer null']) {
      const reply = await read(closed, '', authorization)
      expect(reply.status).toBe(404)
      expect(reply.body).toEqual(unknown.body)
    }
  })

  it('compares the whole token', async () => {
    expect(await hasReadToken(token, `Bearer ${token}`)).toBe(true)
    expect(await hasReadToken(token, `Bearer ${token.slice(0, -1)}`)).toBe(false)
    expect(await hasReadToken(token, `Bearer ${token}${token}`)).toBe(false)
    expect(await hasReadToken(token, undefined)).toBe(false)
  })

  it('answers a caller that is not a browser, and leaves the guard on every other /v1 route as it was', async () => {
    const h = withToken()
    // No Origin, no cookie, no Sec-Fetch-Site: a server's request.
    expect((await read(h)).status).toBe(200)
    // The token opens nothing else, and nothing but reading: a form post from another site is still refused.
    const form = (path: string) =>
      h.request(path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain', origin: 'https://elsewhere.example.com' }, body: '{}' })
    expect((await form('/v1/feedback')).status).toBe(403)
    expect((await form('/v1/admin/feedback')).status).toBe(403)
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const reply = await h.request('/v1/admin/feedback', { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: BASE_URL }, body: '{}' })
      expect(reply.status).toBe(404)
    }
    expect((await h.request('/v1/sync/pull', { headers: { authorization: `Bearer ${token}` } })).status).not.toBe(200)
    expect(await stored(h)).toEqual([])
  })

  it(`gives ${FEEDBACK_PAGE_DEFAULT} a page, and the older ones from the cursor it names`, async () => {
    const h = withToken()
    await seedFeedback(h, FEEDBACK_PAGE_DEFAULT + 2, h.clock.now - HOUR)
    const first = await read(h)
    expect(first.body.items).toHaveLength(FEEDBACK_PAGE_DEFAULT)
    expect(first.body.items[0].message).toBe(`idea ${FEEDBACK_PAGE_DEFAULT + 2}`)
    expect(first.body.nextBefore).toBe(first.body.items.at(-1).id)
    const second = await read(h, `?before=${first.body.nextBefore}`)
    expect(second.body.items.map((item: { message: string }) => item.message)).toEqual(['idea 2', 'idea 1'])
    expect(second.body.nextBefore).toBeNull()
    const small = await read(h, '?limit=2')
    expect(small.body.items.map((item: { message: string }) => item.message)).toEqual([`idea ${FEEDBACK_PAGE_DEFAULT + 2}`, `idea ${FEEDBACK_PAGE_DEFAULT + 1}`])
    expect(small.body.nextBefore).toBe(small.body.items[1].id)
    // A page that ends exactly at the oldest message names no next one.
    expect((await read(h, `?limit=2&before=${second.body.items[0].id + 1}`)).body.nextBefore).toBeNull()
  })

  it('filters by kind and by the time received', async () => {
    const h = withToken()
    await send(h, feedback)
    h.clock.advance(60_000)
    await send(h, { ...feedback, kind: 'idea', message: 'A dark theme.' })
    h.clock.advance(60_000)
    await send(h, { ...feedback, kind: 'other', message: 'Thank you.' })
    const messages = async (query: string) => (await read(h, query)).body.items.map((item: { message: string }) => item.message)
    expect(await messages('?kind=bug')).toEqual(['The path does not open.'])
    expect(await messages('?kind=idea')).toEqual(['A dark theme.'])
    expect(await messages(`?since=${h.clock.now - 60_000}`)).toEqual(['Thank you.', 'A dark theme.'])
    expect(await messages(`?since=${h.clock.now - 60_000}&kind=idea`)).toEqual(['A dark theme.'])
  })

  it('refuses a query it does not understand, once the token is right', async () => {
    const h = withToken()
    for (const query of ['?limit=0', `?limit=${FEEDBACK_PAGE_MAX + 1}`, '?limit=ten', '?before=abc', '?before=-1', '?kind=praise', '?since=yesterday']) {
      const reply = await read(h, query)
      expect(reply.status).toBe(400)
      expect(reply.body.error).toBe('invalid')
      expect((await read(h, query, 'Bearer wrong')).status).toBe(404)
    }
    expect((await read(h, `?limit=${FEEDBACK_PAGE_MAX}`)).status).toBe(200)
  })

  it('changes nothing, and never logs the token', async () => {
    const h = withToken()
    await send(h, feedback)
    const before = await stored(h)
    const logs = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})]
    try {
      await read(h)
      await read(h, '?limit=0')
      await read(h, '', 'Bearer wrong')
      for (const log of logs) expect(JSON.stringify(log.mock.calls)).not.toContain(token)
    } finally {
      for (const log of logs) log.mockRestore()
    }
    expect(await stored(h)).toEqual(before)
  })

  it('no longer gives the address of a deleted account', async () => {
    const h = withToken()
    const s = await h.signIn()
    await s.post('/v1/feedback', { ...feedback, email: 'ana@example.com' })
    expect((await read(h)).body.items[0].contactEmail).toBe('ana@example.com')
    expect((await s.del('/v1/account', { confirm: true })).status).toBe(200)
    const [item] = (await read(h)).body.items
    expect(item.message).toBe('The path does not open.')
    expect(item.contactEmail).toBe('')
    expect(item.signedIn).toBe(false)
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

  describe('when the review app shows the feedback (FEEDBACK_READ_TOKEN is set)', () => {
    const review = 'https://review.example.com'
    const withTab = (reviewAppUrl: string | null = review) => harness({ config: { feedbackEmail: to, feedbackReadToken: 'r'.repeat(40), reviewAppUrl } })

    it('is a notice: how many are new, by kind, and a link to the Feedback tab, with no message or address in it', async () => {
      const h = withTab()
      const s = await h.signIn()
      await s.post('/v1/feedback', { ...feedback, email: 'ana@example.com' })
      await send(h, { ...feedback, message: 'It also crashes.' })
      await send(h, { ...feedback, kind: 'idea', message: 'A dark theme.' }, '10.30.0.2')
      await runScheduled(h.deps)
      expect(h.feedbackMails).toEqual([
        {
          to,
          subject: 'Wordado feedback: 3 new',
          text: '3 new messages about the app.\n\nSomething isn’t working: 2\nIdeas: 1\n\nRead them in the review app: https://review.example.com/#feedback',
        },
      ])
      const mail = h.feedbackMails[0]!
      for (const kept of ['The path does not open.', 'It also crashes.', 'A dark theme.', 'ana@example.com', s.userId, 'Mozilla', 'B3kq9xZa']) expect(mail.text).not.toContain(kept)
      expect((await stored(h)).map((row) => row['mailed_at'])).toEqual([h.clock.now, h.clock.now, h.clock.now])
    })

    it('says where to look when the review app’s address is not set', async () => {
      const h = withTab(null)
      await send(h, { ...feedback, kind: 'other' })
      await runScheduled(h.deps)
      expect(h.feedbackMails[0]!.text).toBe('1 new message about the app.\n\nSomething else: 1\n\nRead them in the review app: Admin, then Feedback.')
    })

    it(`counts every waiting message, more than ${FEEDBACK_MAIL_MAX} too, and leaves none for the next day`, async () => {
      const h = withTab()
      await seedFeedback(h, FEEDBACK_MAIL_MAX + 3, h.clock.now - HOUR)
      expect(await mailNewFeedback(h.deps)).toBe(FEEDBACK_MAIL_MAX + 3)
      expect(h.feedbackMails[0]!.subject).toBe(`Wordado feedback: ${FEEDBACK_MAIL_MAX + 3} new`)
      expect(h.feedbackMails[0]!.text).toContain(`Ideas: ${FEEDBACK_MAIL_MAX + 3}\n`)
      expect(await h.deps.db.query('select id from feedback where mailed_at is null')).toEqual([])
      h.clock.advance(DAY)
      expect(await mailNewFeedback(h.deps)).toBe(0)
      expect(h.feedbackMails).toHaveLength(1)
    })

    it('is still one mail a UTC day, and a failed send waits for the next', async () => {
      const h = withTab()
      h.clock.now = Math.floor(h.clock.now / DAY) * DAY + HOUR
      await send(h, feedback)
      const failing = vi.spyOn(h.deps.mailer, 'sendFeedback').mockRejectedValueOnce(new Error('Resend refused the email: 500'))
      await expect(runScheduled(h.deps)).rejects.toThrow(AggregateError)
      await send(h, { ...feedback, kind: 'idea' })
      await runScheduled(h.deps)
      expect(failing).toHaveBeenCalledTimes(1)
      expect((await stored(h)).map((row) => row['mailed_at'])).toEqual([null, null])
      h.clock.advance(DAY)
      await runScheduled(h.deps)
      await runScheduled(h.deps)
      expect(h.feedbackMails).toHaveLength(1)
      expect(h.feedbackMails[0]!.subject).toBe('Wordado feedback: 2 new')
    })

    it('names only the kinds that have something new', () => {
      expect(feedbackNotice({ bug: 0, idea: 0, other: 2 }, review).text).toBe('2 new messages about the app.\n\nSomething else: 2\n\nRead them in the review app: https://review.example.com/#feedback')
    })
  })
})
