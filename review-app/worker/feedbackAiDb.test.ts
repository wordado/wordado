import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Env } from './bindings'
import {
  aiCallsToday,
  claimAiCall,
  dropFeedbackAiNotIn,
  feedbackAiRows,
  feedbackMarks,
  forgetFeedbackAi,
  getSetting,
  insertReviewer,
  putFeedbackAi,
  putFeedbackMark,
  putSetting,
  type FeedbackAiRow,
} from './db'
import { resetDb, startPlatform } from './test/platform'

let base: Env
let dispose: () => Promise<void>

beforeAll(async () => {
  const p = await startPlatform()
  base = p.env
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(async () => {
  await resetDb(base.DB)
  await insertReviewer(base.DB, { email: 'admin@example.com', name: 'Coordinator', languages: ['bg'], role: 'admin', invitedAt: 't', inviteSentAt: null, disabledAt: null })
})

const row = (over: Partial<FeedbackAiRow> = {}): FeedbackAiRow => ({
  receivedAt: 1_780_000_000_000,
  language: 'de',
  translation: 'The sound plays twice.',
  category: 'bug',
  severity: 'annoys',
  summary: 'The sound of a word plays twice.',
  model: 'test/model',
  promptVersion: 1,
  createdAt: '2026-10-05T12:00:00.000Z',
  ...over,
})
const stored = async () => (await base.DB.prepare('SELECT feedback_id FROM feedback_ai ORDER BY feedback_id').all<{ feedback_id: number }>()).results.map((r) => r.feedback_id)
const at = (iso: string) => new Date(iso)

describe('the AI’s reading of a message, kept by its id (spec 2026-10-10 §4)', () => {
  it('keeps a row and gives it back, with a severity or none', async () => {
    const praise = row({ language: 'bg', translation: '', category: 'praise', severity: null, summary: 'Thanks for the app.' })
    await putFeedbackAi(base.DB, new Map([[7, row()], [9, praise]]))
    const found = await feedbackAiRows(base.DB, [7, 8, 9])
    expect([...found.keys()].sort()).toEqual([7, 9])
    expect(found.get(7)).toEqual(row())
    expect(found.get(9)).toEqual(praise)
    expect((await feedbackAiRows(base.DB, [])).size).toBe(0)
    await putFeedbackAi(base.DB, new Map())
  })

  it('replaces the row of a message that is read again', async () => {
    await putFeedbackAi(base.DB, new Map([[7, row({ promptVersion: 0 })]]))
    const again = row({ category: 'idea', severity: null, summary: 'Wants the sound once.', promptVersion: 1, model: 'test/other', createdAt: '2026-10-06T12:00:00.000Z' })
    await putFeedbackAi(base.DB, new Map([[7, again]]))
    expect(await stored()).toEqual([7])
    expect((await feedbackAiRows(base.DB, [7])).get(7)).toEqual(again)
  })

  it('drops the results between two ids whose message is no longer given, and no other', async () => {
    await putFeedbackAi(base.DB, new Map([1, 2, 3, 4, 5, 6].map((id) => [id, row()])))
    // The page held 5 and 3; 2 is its lowest id although its message is kept; 1 and 6 lie outside.
    expect(await dropFeedbackAiNotIn(base.DB, 2, 5, [5, 3, 2])).toBe(1)
    expect(await stored()).toEqual([1, 2, 3, 5, 6])
    expect(await dropFeedbackAiNotIn(base.DB, 2, 5, [5, 3, 2])).toBe(0)
  })

  it('forgets every result and leaves the marks and the count of calls', async () => {
    await putFeedbackAi(base.DB, new Map([1, 2, 3].map((id) => [id, row()])))
    await putFeedbackMark(base.DB, 2, { state: 'seen', note: 'Mine.', updatedAt: 't', updatedBy: 'admin@example.com' })
    await claimAiCall(base.DB, at('2026-10-05T12:00:00Z'), 'messages', 3, 10)
    expect(await forgetFeedbackAi(base.DB)).toBe(3)
    expect(await stored()).toEqual([])
    expect((await feedbackMarks(base.DB, [2])).get(2)).toMatchObject({ state: 'seen', note: 'Mine.' })
    expect(await aiCallsToday(base.DB, at('2026-10-05T13:00:00Z'))).toBe(1)
    expect(await forgetFeedbackAi(base.DB)).toBe(0)
  })
})

describe('the daily limit of calls to the model (spec 2026-10-10 §2 rule 7)', () => {
  it('lets a call through while the UTC day is under its limit, and counts it', async () => {
    const noon = at('2026-10-05T12:00:00Z')
    for (let i = 0; i < 3; i += 1) expect(await claimAiCall(base.DB, noon, 'messages', 25, 3)).toBe(true)
    expect(await claimAiCall(base.DB, noon, 'messages', 25, 3)).toBe(false)
    expect(await aiCallsToday(base.DB, noon)).toBe(3)
    expect((await base.DB.prepare('SELECT day, at, what, messages FROM feedback_ai_calls').all()).results[0]).toEqual({ day: '2026-10-05', at: '2026-10-05T12:00:00.000Z', what: 'messages', messages: 25 })
  })

  it('lets none through with a limit of 0', async () => {
    expect(await claimAiCall(base.DB, at('2026-10-05T12:00:00Z'), 'messages', 1, 0)).toBe(false)
    expect(await aiCallsToday(base.DB, at('2026-10-05T12:00:00Z'))).toBe(0)
  })

  it('starts again with the next UTC day', async () => {
    const late = at('2026-10-05T23:59:59Z')
    const early = at('2026-10-06T00:00:01Z')
    expect(await claimAiCall(base.DB, late, 'messages', 1, 1)).toBe(true)
    expect(await claimAiCall(base.DB, late, 'messages', 1, 1)).toBe(false)
    expect(await aiCallsToday(base.DB, early)).toBe(0)
    expect(await claimAiCall(base.DB, early, 'messages', 1, 1)).toBe(true)
    expect(await aiCallsToday(base.DB, late)).toBe(1)
  })
})

describe('what an admin switches in the app', () => {
  it('has no value until one is set, then the last one set', async () => {
    expect(await getSetting(base.DB, 'feedback_ai')).toBeNull()
    await putSetting(base.DB, 'feedback_ai', 'on', 'admin@example.com', '2026-10-05T12:00:00.000Z')
    expect(await getSetting(base.DB, 'feedback_ai')).toBe('on')
    await putSetting(base.DB, 'feedback_ai', 'off', 'admin@example.com', '2026-10-06T12:00:00.000Z')
    expect(await getSetting(base.DB, 'feedback_ai')).toBe('off')
    expect((await base.DB.prepare('SELECT * FROM settings').all()).results).toEqual([{ name: 'feedback_ai', value: 'off', updated_at: '2026-10-06T12:00:00.000Z', updated_by: 'admin@example.com' }])
  })
})
