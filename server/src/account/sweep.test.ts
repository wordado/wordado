import { describe, expect, it, vi } from 'vitest'
import { harness, type Harness } from '../../test/harness'
import { runScheduled } from '../jobs/scheduled'
import { ACCOUNT_SWEEP_BATCH, accountSweepStatus, INACTIVE_ACCOUNT_MONTHS, INACTIVE_ACCOUNT_MS, sweepInactiveAccounts } from './sweep'

const DAY = 86_400_000

let made = 0

/** An account written directly, last signed in `ago` milliseconds before the harness's clock; null is one with no date. */
async function account(h: Harness, ago: number | null): Promise<string> {
  made += 1
  const id = `swept-${made}`
  await h.deps.db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", last_sign_in_at) values ($1, '', $2, true, $3, $3, $4)`,
    [id, `${id}@example.com`, new Date(h.clock.now - 4 * 365 * DAY), ago === null ? null : new Date(h.clock.now - ago)],
  )
  return id
}

const ids = async (h: Harness): Promise<string[]> => (await h.deps.db.query<{ id: string }>('select id from "user" order by id')).map((r) => r.id)

describe('the sweep of inactive accounts (#187)', () => {
  it('means 24 months by its threshold, and never less than 24 calendar months', () => {
    expect(INACTIVE_ACCOUNT_MONTHS).toBe(24)
    // Two years with a leap day in them: the longest 24 months there are.
    expect(INACTIVE_ACCOUNT_MS).toBe(731 * DAY)
  })

  it('takes only the accounts last signed in before the threshold, and never one with no date', async () => {
    const h = harness()
    const past = await account(h, INACTIVE_ACCOUNT_MS + 1)
    const longPast = await account(h, INACTIVE_ACCOUNT_MS + 400 * DAY)
    const onIt = await account(h, INACTIVE_ACCOUNT_MS)
    const within = await account(h, INACTIVE_ACCOUNT_MS - 1)
    const recent = await account(h, DAY)
    const undated = await account(h, null)
    expect(await accountSweepStatus(h.deps)).toMatchObject({ due: 2, undated: 1, taken: 0, lastRunAt: null, lastTaken: 0 })
    expect(await sweepInactiveAccounts(h.deps)).toBe(2)
    expect(await ids(h)).toEqual([onIt, within, recent, undated].sort())
    expect(await ids(h)).not.toContain(past)
    expect(await ids(h)).not.toContain(longPast)
    expect(await accountSweepStatus(h.deps)).toEqual({
      months: INACTIVE_ACCOUNT_MONTHS,
      batch: ACCOUNT_SWEEP_BATCH,
      due: 0,
      undated: 1,
      taken: 2,
      lastRunAt: h.clock.now,
      lastTaken: 2,
    })
  })

  it('never takes an account with a session used since the threshold, whatever its date says', async () => {
    const h = harness()
    const kept = await account(h, INACTIVE_ACCOUNT_MS + 400 * DAY)
    const gone = await account(h, INACTIVE_ACCOUNT_MS + 400 * DAY)
    const session = (userId: string, usedAgo: number) =>
      h.deps.db.query(
        `insert into "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId") values ($1, $2, $1, $3, $3, $4)`,
        [`session-${userId}`, new Date(h.clock.now + DAY), new Date(h.clock.now - usedAgo), userId],
      )
    await session(kept, INACTIVE_ACCOUNT_MS - DAY)
    await session(gone, INACTIVE_ACCOUNT_MS + DAY)
    expect((await accountSweepStatus(h.deps)).due).toBe(1)
    expect(await sweepInactiveAccounts(h.deps)).toBe(1)
    expect(await ids(h)).toEqual([kept])
  })

  it(`takes at most ${ACCOUNT_SWEEP_BATCH} in one run, the longest away first, and does its work once a UTC day`, async () => {
    const h = harness()
    // Written directly: the sweep reads nothing else of an account.
    await h.deps.db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", last_sign_in_at)
       select 'bulk-' || n, '', 'bulk-' || n || '@example.com', true, $1, $1, $1::timestamptz - n * interval '1 day' from generate_series(1, $2) as n`,
      [new Date(h.clock.now - INACTIVE_ACCOUNT_MS), ACCOUNT_SWEEP_BATCH + 5],
    )
    expect(await accountSweepStatus(h.deps)).toMatchObject({ due: ACCOUNT_SWEEP_BATCH + 5, batch: ACCOUNT_SWEEP_BATCH })
    expect(await sweepInactiveAccounts(h.deps)).toBe(ACCOUNT_SWEEP_BATCH)
    expect(await ids(h)).toEqual(['bulk-1', 'bulk-2', 'bulk-3', 'bulk-4', 'bulk-5'])
    // The cron comes every 15 minutes: the rest of the day it does nothing.
    expect(await sweepInactiveAccounts(h.deps)).toBeNull()
    h.clock.advance(15 * 60_000)
    expect(await sweepInactiveAccounts(h.deps)).toBeNull()
    expect(await ids(h)).toHaveLength(5)
    expect(await accountSweepStatus(h.deps)).toMatchObject({ due: 5, taken: ACCOUNT_SWEEP_BATCH, lastTaken: ACCOUNT_SWEEP_BATCH })
    h.clock.advance(DAY)
    expect(await sweepInactiveAccounts(h.deps)).toBe(5)
    expect(await ids(h)).toEqual([])
    expect(await accountSweepStatus(h.deps)).toMatchObject({ due: 0, taken: ACCOUNT_SWEEP_BATCH + 5, lastRunAt: h.clock.now, lastTaken: 5 })
    expect(await h.deps.db.query('select deleted from account_sweep order by utc_day')).toEqual([{ deleted: ACCOUNT_SWEEP_BATCH }, { deleted: 5 }])
  })

  it('deletes as the learner’s own deletion does: the report and the feedback stay without them', async () => {
    const h = harness()
    const s = await h.signIn()
    await s.post('/v1/feedback', { kind: 'idea', message: 'A dark theme, please.', email: s.email, appVersion: 'v', corpusVersion: 'bg 6', language: 'bg', screen: '/', userAgent: 'ua' })
    await h.deps.db.query(
      `insert into content_report (reporter_id, report_key, word_id, field, note, pack_version, created_at, received_at) values ($1, 'rep-1', 'c:w-1', 'translation', 'robotic', 0, 1, 1)`,
      [s.userId],
    )
    // Away for the whole time: the session went long ago, and so did the last sign-in.
    await h.deps.db.query('delete from "session" where "userId" = $1', [s.userId])
    await h.deps.db.query('update "user" set last_sign_in_at = $2 where id = $1', [s.userId, new Date(h.clock.now - INACTIVE_ACCOUNT_MS - DAY)])
    expect(await sweepInactiveAccounts(h.deps)).toBe(1)
    expect(await ids(h)).toEqual([])
    expect(await h.deps.db.query('select reporter_id, note from content_report')).toEqual([{ reporter_id: null, note: 'robotic' }])
    expect(await h.deps.db.query('select message, contact_email from feedback')).toEqual([{ message: 'A dark theme, please.', contact_email: '' }])
    expect(await h.deps.db.query('select email from sign_in_code_send')).toEqual([])
  })

  it('logs how many it deleted, and nothing that names one of them', async () => {
    const h = harness()
    const id = await account(h, INACTIVE_ACCOUNT_MS + DAY)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await sweepInactiveAccounts(h.deps)
      expect(log.mock.calls).toEqual([['account sweep: 1 inactive account(s) deleted']])
      expect(JSON.stringify(log.mock.calls)).not.toContain(id)
    } finally {
      log.mockRestore()
    }
  })

  it('runs with the cron, and leaves alone a learner who signed in a moment ago', async () => {
    const h = harness()
    const s = await h.signIn()
    const old = await account(h, INACTIVE_ACCOUNT_MS + DAY)
    await runScheduled(h.deps)
    expect(await ids(h)).toEqual([s.userId])
    expect(await ids(h)).not.toContain(old)
    await runScheduled(h.deps)
    expect(await h.deps.db.query('select deleted from account_sweep')).toEqual([{ deleted: 1 }])
  })
})
