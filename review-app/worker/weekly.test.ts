import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Env } from './bindings'
import { claimWeeklyMail, insertReviewer, releaseWeeklyMail, settleWeeklyMail } from './db'
import { FakeLearnerApp, feedbackItem } from './test/fakeLearnerApp'
import { resetDb, startPlatform, testDeps } from './test/platform'
import { countWeek, runWeekly, weekOf, WEEKLY_PAGES } from './weekly'

let base: Env
let dispose: () => Promise<void>

beforeAll(async () => {
  const p = await startPlatform()
  base = p.env
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(() => resetDb(base.DB))

const rows = async () => (await base.DB.prepare('SELECT week, claimed_at, messages, sent_at FROM weekly_mails ORDER BY week').all()).results

describe('the weekly mail’s guard', () => {
  const WEEK = '2026-10-12'
  const at = (iso: string) => new Date(iso)

  it('gives a week to the first run that asks and to no second one', async () => {
    expect(await claimWeeklyMail(base.DB, WEEK, at('2026-10-12T06:00:00Z'))).toBe(true)
    expect(await claimWeeklyMail(base.DB, WEEK, at('2026-10-12T06:00:01Z'))).toBe(false)
    expect(await rows()).toEqual([{ week: WEEK, claimed_at: '2026-10-12T06:00:00.000Z', messages: null, sent_at: null }])
    // Another week is another row.
    expect(await claimWeeklyMail(base.DB, '2026-10-19', at('2026-10-19T06:00:00Z'))).toBe(true)
  })

  it('frees a released week for the next try', async () => {
    await claimWeeklyMail(base.DB, WEEK, at('2026-10-12T06:00:00Z'))
    await releaseWeeklyMail(base.DB, WEEK)
    expect(await rows()).toEqual([])
    expect(await claimWeeklyMail(base.DB, WEEK, at('2026-10-13T06:00:00Z'))).toBe(true)
  })

  it('keeps a settled week: it cannot be claimed or released', async () => {
    await claimWeeklyMail(base.DB, WEEK, at('2026-10-12T06:00:00Z'))
    await settleWeeklyMail(base.DB, WEEK, 7, '2026-10-12T06:00:02.000Z')
    await releaseWeeklyMail(base.DB, WEEK)
    // Long after, when an unfinished claim would have been given up.
    expect(await claimWeeklyMail(base.DB, WEEK, at('2026-10-13T06:00:00Z'))).toBe(false)
    expect(await rows()).toEqual([{ week: WEEK, claimed_at: '2026-10-12T06:00:00.000Z', messages: 7, sent_at: '2026-10-12T06:00:02.000Z' }])
  })

  it('keeps a week with no feedback too, with no time of sending', async () => {
    await claimWeeklyMail(base.DB, WEEK, at('2026-10-12T06:00:00Z'))
    await settleWeeklyMail(base.DB, WEEK, 0, null)
    expect(await claimWeeklyMail(base.DB, WEEK, at('2026-10-13T06:00:00Z'))).toBe(false)
    expect(await rows()).toEqual([{ week: WEEK, claimed_at: '2026-10-12T06:00:00.000Z', messages: 0, sent_at: null }])
  })

  it('gives up an unfinished claim two hours old, and not one ten minutes old', async () => {
    await claimWeeklyMail(base.DB, WEEK, at('2026-10-12T06:00:00Z'))
    expect(await claimWeeklyMail(base.DB, WEEK, at('2026-10-12T06:10:00Z'))).toBe(false)
    expect(await claimWeeklyMail(base.DB, WEEK, at('2026-10-12T08:00:00Z'))).toBe(true)
    expect(await rows()).toEqual([{ week: WEEK, claimed_at: '2026-10-12T08:00:00.000Z', messages: null, sent_at: null }])
  })
})

describe('weekOf', () => {
  const at = (iso: string) => weekOf(new Date(iso))
  it('is the week that ended on the Monday of the week the job runs in, whenever in that week it runs', () => {
    const week = { week: '2026-10-12', since: Date.parse('2026-10-05T00:00:00Z'), until: Date.parse('2026-10-12T00:00:00Z') }
    expect(at('2026-10-12T06:00:00Z')).toEqual(week)
    expect(at('2026-10-12T00:00:00Z')).toEqual(week)
    expect(at('2026-10-13T06:00:00Z')).toEqual(week)
    expect(at('2026-10-18T23:59:59Z')).toEqual(week)
  })
  it('is the week before on a Sunday, and crosses a month and a year', () => {
    expect(at('2026-10-11T23:59:00Z').week).toBe('2026-10-05')
    expect(at('2026-11-01T12:00:00Z')).toEqual({ week: '2026-10-26', since: Date.parse('2026-10-19T00:00:00Z'), until: Date.parse('2026-10-26T00:00:00Z') })
    expect(at('2027-01-01T06:00:00Z').week).toBe('2026-12-28')
  })
})

describe('the weekly job (spec 2026-10-10 §3.4)', () => {
  const TOKEN = 't'.repeat(40)
  const SERVER = 'https://app.test'
  /** Monday, when the job runs: the week is 5 to 11 October. */
  const NOW = '2026-10-12T06:00:00Z'
  const inWeek = (day: number, hour = 9) => Date.UTC(2026, 9, day, hour)
  /** Words no mail and no log line may hold. */
  const SECRET_TEXT = 'Zvukat se chuva dva pati'
  const SECRET_ADDRESS = 'learner-who-wrote@example.com'

  let env: Env
  let server: FakeLearnerApp
  let logged: string[]
  /** The requests to Resend, as sent. */
  let mails: { authorization: string | null; body: { to: string[]; subject: string; text: string } }[]
  let resend: () => Response
  let now: string

  beforeEach(async () => {
    env = { ...base, LEARNER_APP_URL: SERVER, FEEDBACK_READ_TOKEN: TOKEN, RESEND_API_KEY: 're_test' }
    server = new FakeLearnerApp(TOKEN, [
      feedbackItem(1, { receivedAt: inWeek(4, 23), message: 'the day before the week' }),
      feedbackItem(2, { receivedAt: inWeek(5, 0), message: SECRET_TEXT, contactEmail: SECRET_ADDRESS }),
      feedbackItem(3, { receivedAt: inWeek(6), kind: 'idea', message: `${SECRET_TEXT} again` }),
      feedbackItem(4, { receivedAt: inWeek(7), kind: 'bug', contactEmail: SECRET_ADDRESS }),
      feedbackItem(5, { receivedAt: inWeek(8), kind: 'other' }),
      feedbackItem(6, { receivedAt: inWeek(11, 23), kind: 'idea' }),
      feedbackItem(7, { receivedAt: inWeek(12, 0), message: 'on the Monday itself' }),
      feedbackItem(8, { receivedAt: inWeek(12, 5), kind: 'other' }),
    ])
    logged = []
    mails = []
    resend = () => new Response('{}')
    now = NOW
    await insertReviewer(env.DB, { email: 'admin@example.com', name: 'Coordinator', languages: ['bg'], role: 'admin', invitedAt: 't', inviteSentAt: null, disabledAt: null })
    await insertReviewer(env.DB, { email: 'second@example.com', name: 'Second', languages: ['de'], role: 'admin', invitedAt: 't', inviteSentAt: null, disabledAt: null })
    await insertReviewer(env.DB, { email: 'gone@example.com', name: 'Gone', languages: ['de'], role: 'admin', invitedAt: 't', inviteSentAt: null, disabledAt: '2026-10-01T00:00:00.000Z' })
    await insertReviewer(env.DB, { email: 'ivan@example.com', name: 'Ivan', languages: ['bg'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
  })

  const deps = () =>
    testDeps(env, {
      now: () => new Date(now),
      log: (line) => logged.push(line),
      fetch: async (input, init = {}) => {
        if (!input.startsWith('https://api.resend.com/')) return server.fetch(input, init)
        mails.push({ authorization: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) })
        return resend()
      },
    })
  const period = { since: inWeek(5, 0), until: inWeek(12, 0) }

  it('counts the week by the learner’s own kind, and asks for nothing older', async () => {
    expect(await countWeek(deps(), { url: SERVER, token: TOKEN }, period)).toEqual({ total: 5, more: false, byKind: { bug: 2, idea: 2, other: 1 } })
    expect(server.requests).toEqual([`GET /v1/admin/feedback?limit=100&since=${period.since}`])
  })

  it('mails every active admin, and no reviewer and no disabled admin', async () => {
    expect(await runWeekly(deps())).toBe('sent')
    expect(mails).toHaveLength(1)
    expect(mails[0]!.authorization).toBe('Bearer re_test')
    expect(mails[0]!.body).toEqual({
      from: env.MAIL_FROM,
      to: ['admin@example.com', 'second@example.com'],
      subject: 'Wordado feedback: 5 messages this week',
      text: '5 messages came from learners between 2026-10-05 and 2026-10-11.\n\nSomething isn\'t working: 2\nAn idea: 2\nSomething else: 1\n\nRead them: https://review.test/#feedback',
    })
    expect(await rows()).toEqual([{ week: '2026-10-12', claimed_at: '2026-10-12T06:00:00.000Z', messages: 5, sent_at: '2026-10-12T06:00:00.000Z' }])
  })

  it('puts nothing a learner wrote, and no address of one, in the mail or in a log line', async () => {
    // With a key the mail goes to Resend; without one it is a log line. Neither may carry a learner's words.
    await runWeekly(deps())
    env = { ...base, LEARNER_APP_URL: SERVER, FEEDBACK_READ_TOKEN: TOKEN }
    now = '2026-10-19T06:00:00Z'
    server.items = server.items.map((item) => ({ ...item, receivedAt: item.receivedAt + 7 * 24 * 60 * 60 * 1000 }))
    expect(await runWeekly(deps())).toBe('sent')
    server.failure = new Error(`${SECRET_TEXT} ${SECRET_ADDRESS}`)
    now = '2026-10-26T06:00:00Z'
    expect(await runWeekly(deps())).toBe('failed')
    const said = `${JSON.stringify(mails)}\n${logged.join('\n')}`
    expect(mails).toHaveLength(1)
    expect(logged.length).toBeGreaterThan(2)
    for (const item of server.items) expect(said).not.toContain(item.message)
    expect(said).not.toContain(SECRET_TEXT)
    expect(said).not.toContain(SECRET_ADDRESS)
    expect(said).not.toContain(TOKEN)
  })

  it('sends nothing in a week with no feedback, and looks only once', async () => {
    server.items = [feedbackItem(1, { receivedAt: inWeek(4, 23) }), feedbackItem(7, { receivedAt: inWeek(12, 0) })]
    expect(await runWeekly(deps())).toBe('none')
    expect(mails).toEqual([])
    expect(await rows()).toEqual([{ week: '2026-10-12', claimed_at: '2026-10-12T06:00:00.000Z', messages: 0, sent_at: null }])
    // Tuesday's trigger.
    now = '2026-10-13T06:00:00Z'
    const asked = server.requests.length
    expect(await runWeekly(deps())).toBe('already')
    expect(server.requests).toHaveLength(asked)
    expect(mails).toEqual([])
  })

  it('sends one mail when it runs twice, and makes no request the second time', async () => {
    expect(await runWeekly(deps())).toBe('sent')
    const asked = server.requests.length
    now = '2026-10-13T06:00:00Z'
    expect(await runWeekly(deps())).toBe('already')
    expect(server.requests).toHaveLength(asked)
    expect(mails).toHaveLength(1)
  })

  it('gives the week back when the app’s server is not reached, so Tuesday’s run sends the mail', async () => {
    server.failure = new TypeError('fetch failed')
    expect(await runWeekly(deps())).toBe('failed')
    expect(mails).toEqual([])
    expect(await rows()).toEqual([])
    expect(logged.at(-1)).toBe('weekly mail not sent: The app’s server could not be reached.')
    server.failure = null
    now = '2026-10-13T06:00:00Z'
    expect(await runWeekly(deps())).toBe('sent')
    expect(mails[0]!.body.subject).toBe('Wordado feedback: 5 messages this week')
  })

  it('gives the week back when the mail service refuses', async () => {
    resend = () => new Response('a body that is not logged', { status: 422 })
    expect(await runWeekly(deps())).toBe('failed')
    expect(await rows()).toEqual([])
    expect(logged.at(-1)).toBe('weekly mail not sent: Resend refused the email: 422')
    resend = () => new Response('{}')
    expect(await runWeekly(deps())).toBe('sent')
    expect(mails).toHaveLength(2)
  })

  it('keeps the week when the mail went and only the record of it failed, so no second mail follows at once', async () => {
    const db = env.DB
    env = {
      ...env,
      DB: {
        batch: (statements) => db.batch(statements),
        prepare: (sql) => {
          if (sql.startsWith('UPDATE weekly_mails')) throw new Error('the database is away')
          return db.prepare(sql)
        },
      },
    }
    expect(await runWeekly(deps())).toBe('sent')
    expect(mails).toHaveLength(1)
    expect(logged.at(-1)).toBe('weekly mail: sent for the week that ended on 2026-10-12, but not recorded: Error')
    expect(await runWeekly(deps())).toBe('already')
    expect(mails).toHaveLength(1)
  })

  it('gives the week back when there is no admin to tell', async () => {
    await env.DB.prepare("UPDATE reviewers SET disabled_at = 't' WHERE role = 'admin'").run()
    expect(await runWeekly(deps())).toBe('failed')
    expect(mails).toEqual([])
    expect(await rows()).toEqual([])
    expect(logged.at(-1)).toBe('weekly mail not sent: no admin to send it to')
  })

  it('does nothing while the learner app’s server is not connected', async () => {
    env = { ...base, LEARNER_APP_URL: SERVER, RESEND_API_KEY: 're_test' }
    expect(await runWeekly(deps())).toBe('unconnected')
    expect(server.requests).toEqual([])
    expect(mails).toEqual([])
    expect(await rows()).toEqual([])
    expect(logged).toEqual(['weekly mail: not connected, LEARNER_APP_URL and FEEDBACK_READ_TOKEN are not both set'])
  })

  it('stops at the cap and says there are more', async () => {
    server.items = Array.from({ length: 1050 }, (_, i) => feedbackItem(i + 1, { receivedAt: inWeek(5, 0) + i * 60_000, kind: i % 2 === 0 ? 'bug' : 'idea' }))
    expect(await runWeekly(deps())).toBe('sent')
    expect(server.requests).toHaveLength(WEEKLY_PAGES)
    expect(server.requests[0]).toBe(`GET /v1/admin/feedback?limit=100&since=${period.since}`)
    expect(server.requests[1]).toBe(`GET /v1/admin/feedback?limit=100&before=951&since=${period.since}`)
    expect(mails[0]!.body.subject).toBe('Wordado feedback: more than 1,000 messages this week')
    expect(mails[0]!.body.text).toContain('Of the 1,000 counted:\nSomething isn\'t working: 500\nAn idea: 500\n')
    expect((await rows())[0]).toMatchObject({ messages: 1000 })
  })

  it('reads every page of a week that fits under the cap', async () => {
    server.items = Array.from({ length: 250 }, (_, i) => feedbackItem(i + 1, { receivedAt: inWeek(5, 0) + i * 60_000 }))
    expect(await countWeek(deps(), { url: SERVER, token: TOKEN }, period)).toEqual({ total: 250, more: false, byKind: { bug: 250, idea: 0, other: 0 } })
    expect(server.requests).toHaveLength(3)
  })
})
