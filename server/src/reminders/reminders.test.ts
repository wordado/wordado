import { applyGrade, Grade, type WordId } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { harness, type Harness, type Session } from '../../test/harness'
import { rawEvent, stamped } from '../../test/events'
import type { VapidKeys } from '../deps'
import { insertEvents } from '../sync/events'
import { MAX_IGNORED_REMINDERS, sendDueReminders } from './schedule'
import { reminderText } from './text'
import { generateVapidKeys } from './vapid'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** Today's UTC midnight. Subscriptions here use offset 0, so local time is UTC. */
const MIDNIGHT = Math.floor(Date.now() / DAY) * DAY

let vapid: VapidKeys | null = null
async function withReminders(): Promise<Harness> {
  vapid ??= await generateVapidKeys('mailto:reminders@wordado.com')
  return harness({ config: { vapid } })
}

function at(h: Harness, day: number, hour: number, minute = 0): void {
  h.clock.now = MIDNIGHT + day * DAY + hour * HOUR + minute * MINUTE
}

async function subscribe(s: Session, over: Record<string, unknown> = {}): Promise<string> {
  const body = {
    endpoint: `https://fcm.googleapis.com/fcm/send/${s.userId}`,
    keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', auth: 'tBHItJI5svbpez7KI4CCXg' },
    reminderMinute: 9 * 60,
    tzOffsetMin: 0,
    language: 'en',
    streakNudge: false,
    ...over,
  }
  const reply = await s.put('/v1/push/subscription', body)
  expect(reply.status).toBe(200)
  return body.endpoint
}

/** An answer the server received at `h.clock.now`, dated today in UTC. */
async function study(h: Harness, s: Session, seq: number): Promise<void> {
  await insertEvents(h.deps.db, s.userId, [stamped(rawEvent('dev-a', seq, h.clock.now - MINUTE, { clientTzOffsetMin: 0 }), { receivedAt: h.clock.now })])
}

async function completeDay(h: Harness, s: Session, date: string): Promise<void> {
  await h.deps.db.query(`insert into day_complete (user_id, local_date, rule_version, received_at) values ($1, $2, 'r1', 0)`, [s.userId, date])
}

const isoDay = (day: number) => new Date(MIDNIGHT + day * DAY).toISOString().slice(0, 10)

describe('push subscriptions', () => {
  it('stores a subscription for a browser push service, refuses any other endpoint, and deletes on request', async () => {
    const h = await withReminders()
    const s = await h.signIn()
    const endpoint = await subscribe(s)
    expect(await h.deps.db.query('select user_id, reminder_minute, language from push_subscription')).toEqual([
      { user_id: s.userId, reminder_minute: 540, language: 'en' },
    ])
    expect((await s.put('/v1/push/subscription', { ...(await validBody(s)), endpoint: 'https://evil.example/push' })).status).toBe(400)
    expect((await s.put('/v1/push/subscription', { ...(await validBody(s)), reminderMinute: 1440 })).status).toBe(400)
    expect((await s.put('/v1/push/subscription', { ...(await validBody(s)), tzOffsetMin: 900 })).status).toBe(400)
    expect((await s.del('/v1/push/subscription', { endpoint })).status).toBe(200)
    expect(await h.deps.db.query('select endpoint from push_subscription')).toEqual([])
  })

  it('publishes the VAPID public key only when reminders are configured', async () => {
    expect((await harness().request('/v1/push/public-key')).status).toBe(404)
    const h = await withReminders()
    expect((await h.request('/v1/push/public-key')).body).toEqual({ publicKey: vapid!.publicKey })
  })
})

async function validBody(s: Session) {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${s.userId}`,
    keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', auth: 'tBHItJI5svbpez7KI4CCXg' },
    reminderMinute: 540,
    tzOffsetMin: 0,
    language: 'en',
    streakNudge: false,
  }
}

describe('sending reminders (spec §8.11)', () => {
  it('sends the daily reminder once in its window, and not after the learner has studied', async () => {
    const h = await withReminders()
    const s = await h.signIn()
    const endpoint = await subscribe(s)
    at(h, 0, 8, 50)
    expect((await sendDueReminders(h.deps)).sent).toBe(0)
    at(h, 0, 9, 5)
    expect((await sendDueReminders(h.deps)).sent).toBe(1)
    expect(h.pushed).toEqual([endpoint])
    at(h, 0, 9, 10)
    expect((await sendDueReminders(h.deps)).sent).toBe(0)
    at(h, 1, 7)
    await study(h, s, 1)
    at(h, 1, 9, 5)
    expect((await sendDueReminders(h.deps)).sent).toBe(0)
    expect(h.pushed).toHaveLength(1)
  })

  it(`pauses after ${MAX_IGNORED_REMINDERS} ignored reminders and resumes once the learner studies`, async () => {
    const h = await withReminders()
    const s = await h.signIn()
    await subscribe(s)
    for (let day = 0; day < MAX_IGNORED_REMINDERS; day += 1) {
      at(h, day, 9, 5)
      expect((await sendDueReminders(h.deps)).sent).toBe(1)
    }
    at(h, MAX_IGNORED_REMINDERS, 9, 5)
    expect((await sendDueReminders(h.deps)).sent).toBe(0)
    at(h, MAX_IGNORED_REMINDERS, 12)
    await study(h, s, 1)
    at(h, MAX_IGNORED_REMINDERS + 1, 9, 5)
    expect((await sendDueReminders(h.deps)).sent).toBe(1)
  })

  it('nudges at 20:00 when a streak needs today, and not when today is done', async () => {
    const h = await withReminders()
    const atRisk = await h.signIn()
    const done = await h.signIn()
    await subscribe(atRisk, { streakNudge: true })
    await subscribe(done, { streakNudge: true })
    await completeDay(h, atRisk, isoDay(-1))
    await completeDay(h, done, isoDay(-1))
    await completeDay(h, done, isoDay(0))
    at(h, 0, 20, 5)
    const run = await sendDueReminders(h.deps)
    expect(run.sent).toBe(1)
    expect(h.pushed).toEqual([`https://fcm.googleapis.com/fcm/send/${atRisk.userId}`])
  })

  it('forgets a subscription the push service no longer knows', async () => {
    const h = await withReminders()
    const s = await h.signIn()
    await subscribe(s)
    h.pushResult = 'gone'
    at(h, 0, 9, 5)
    expect(await sendDueReminders(h.deps)).toEqual({ sent: 0, gone: 1, failed: 0 })
    expect(await h.deps.db.query('select endpoint from push_subscription')).toEqual([])
  })

  it('counts a failed send and carries on with the others', async () => {
    const h = await withReminders()
    await subscribe(await h.signIn())
    await subscribe(await h.signIn())
    h.pushResult = new Error('push service down')
    at(h, 0, 9, 5)
    expect(await sendDueReminders(h.deps)).toEqual({ sent: 0, gone: 0, failed: 2 })
  })

  it('sends nothing when reminders are not configured', async () => {
    const h = harness()
    await subscribe(await h.signIn())
    at(h, 0, 9, 5)
    expect(await sendDueReminders(h.deps)).toEqual({ sent: 0, gone: 0, failed: 0 })
    expect(h.pushed).toEqual([])
  })
})

describe('GET /v1/reminder', () => {
  async function dueWords(h: Harness, s: Session, words: readonly string[]): Promise<void> {
    for (const word of words) {
      const state = applyGrade(null, word as WordId, Grade.Good, h.clock.now - 30 * DAY, 0)
      await h.deps.db.query('insert into review_state (user_id, word_id, state) values ($1, $2, $3::jsonb)', [s.userId, word, JSON.stringify(state)])
    }
  }

  it("says how many words are due, leaving out flagged ones and keeping to the review cap", async () => {
    const h = await withReminders()
    const s = await h.signIn()
    at(h, 0, 9, 5)
    await dueWords(h, s, ['c:w-1', 'c:w-2', 'c:w-3'])
    await h.deps.db.query(
      `insert into document (user_id, type, key, class, version, fields, field_versions, deleted)
       values ($1, 'word_flag', 'c:w-3', 'versioned', 2, '{"flag": "known"}'::jsonb, '{"flag": 2}'::jsonb, false)`,
      [s.userId],
    )
    expect((await s.get('/v1/reminder?tz=0&lang=en')).body).toEqual({ title: 'Wordado', body: 'You have 2 words to review today.' })
    expect((await s.get('/v1/reminder?tz=0&lang=bg')).body).toEqual({ title: 'Wordado', body: 'Имате 2 думи за преговор днес.' })
    await h.deps.db.query(
      `insert into document (user_id, type, key, class, version, fields, field_versions, deleted)
       values ($1, 'settings', '', 'versioned', 3, '{"reviewCap": 1}'::jsonb, '{"reviewCap": 3}'::jsonb, false)`,
      [s.userId],
    )
    expect((await s.get('/v1/reminder?tz=0&lang=en')).body.body).toBe('You have 1 word to review today.')
  })

  it('speaks of the streak in the evening when today is still to do', async () => {
    const h = await withReminders()
    const s = await h.signIn()
    await completeDay(h, s, isoDay(-2))
    await completeDay(h, s, isoDay(-1))
    at(h, 0, 20, 30)
    expect((await s.get('/v1/reminder?tz=0&lang=en')).body.body).toBe("Your 2-day streak needs today's practice.")
  })

  it('refuses a missing or impossible offset', async () => {
    const h = await withReminders()
    const s = await h.signIn()
    expect((await s.get('/v1/reminder')).status).toBe(400)
    expect((await s.get('/v1/reminder?tz=900')).status).toBe(400)
  })
})

describe('reminderText', () => {
  it('says one word and many words properly in both languages', () => {
    expect(reminderText('en', { kind: 'due', count: 1 }).body).toBe('You have 1 word to review today.')
    expect(reminderText('en', { kind: 'due', count: 0 }).body).toBe('A few minutes of new words today?')
    expect(reminderText('bg', { kind: 'due', count: 1 }).body).toBe('Имате 1 дума за преговор днес.')
    expect(reminderText('bg', { kind: 'streak', days: 1 }).body).toBe('Поредицата ви от 1 ден има нужда от днешното упражнение.')
    expect(reminderText('bg', { kind: 'streak', days: 5 }).body).toBe('Поредицата ви от 5 дни има нужда от днешното упражнение.')
  })
})
