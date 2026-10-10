import { MAX_FEEDBACK_MESSAGE_LENGTH } from '@wordado/core'
import { describe, expect, it, vi } from 'vitest'
import { BASE_URL, harness, type Harness, type Reply } from '../../test/harness'
import { runScheduled } from '../jobs/scheduled'
import { FEEDBACK_PAGE_DEFAULT, FEEDBACK_PAGE_MAX, hasReadToken } from './admin'
import { FEEDBACK_PER_CLIENT_PER_HOUR, FEEDBACK_PER_DAY, FEEDBACK_SEND_RETENTION_MS, feedbackClient, pruneFeedbackSends } from './limit'

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
    'select signed_in, kind, message, contact_email, app_version, corpus_version, user_agent, language, screen, received_at from feedback order by id',
  )


/** `count` messages, received a minute apart from `from`. */
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
        signed_in: false,
        kind: 'bug',
        message: 'The path does not open.',
        contact_email: 'ana@example.com',
        app_version: 'B3kq9xZa',
        corpus_version: 'bg 6',
        user_agent: 'Mozilla/5.0 (X11; Linux x86_64)',
        language: 'bg',
        screen: '/path',
        received_at: h.clock.now,
      },
    ])
  })

  it('records that a signed-in sender was signed in, never who, unless the client names another learner (#166)', async () => {
    const h = harness()
    const s = await h.signIn()
    expect((await s.post('/v1/feedback', { ...feedback, kind: 'idea' })).status).toBe(200)
    expect((await s.post('/v1/feedback', feedback, { 'x-wordado-user': s.userId })).status).toBe(200)
    expect((await s.post('/v1/feedback', feedback, { 'x-wordado-user': 'someone-else' })).status).toBe(200)
    expect((await stored(h)).map((row) => row['signed_in'])).toEqual([true, true, false])
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

  it('no longer gives the address of a deleted account, and keeps another address the learner chose to give (#166)', async () => {
    const h = withToken()
    const s = await h.signIn()
    await s.post('/v1/feedback', { ...feedback, email: s.email.toUpperCase() })
    await s.post('/v1/feedback', { ...feedback, kind: 'idea', email: 'other@example.com' })
    expect((await read(h)).body.items.map((item: { contactEmail: string }) => item.contactEmail)).toEqual(['other@example.com', s.email.toUpperCase()])
    expect((await s.del('/v1/account', { confirm: true })).status).toBe(200)
    // No row names the account, so only the account's own address can be found and removed; an address the
    // learner typed on purpose is theirs to give, and stays with the message.
    const items = (await read(h)).body.items
    expect(items.map((item: { contactEmail: string; signedIn: boolean }) => [item.contactEmail, item.signedIn])).toEqual([['other@example.com', true], ['', true]])
  })
})

