import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Env } from './bindings'
import { claimWeeklyMail, releaseWeeklyMail, settleWeeklyMail } from './db'
import { resetDb, startPlatform } from './test/platform'

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
