import { describe, expect, it } from 'vitest'
import { SCHEDULER_VERSION } from './scheduler'
import { SYNC_PAGE_SIZE } from './syncProtocol'
import { MAX_LATENCY_MS, MAX_PAGE_DOCUMENTS, parsePullRequest, parsePushPage, protocolVersionOf } from './syncValidation'

const event = (over: Record<string, unknown> = {}) => ({
  reviewId: 'r-1',
  wordId: 'c:hello-1',
  mode: 'multiple_choice',
  direction: 'en_to_l1',
  grade: 3,
  latencyMs: 1500,
  practice: false,
  clientTs: 1_790_000_000_000,
  clientTzOffsetMin: 180,
  deviceId: 'dev-a',
  deviceSeq: 1,
  schedulerVersion: SCHEDULER_VERSION,
  ...over,
})

const page = (over: Record<string, unknown> = {}) => ({
  protocolVersion: 1,
  pushId: 'push-1',
  clientNow: 1_790_000_100_000,
  deviceId: 'dev-a',
  page: 0,
  lastPage: true,
  events: [event()],
  dayComplete: [{ localDate: '2026-09-23', ruleVersion: 'r1' }],
  documents: [{ type: 'settings', key: '', patch: { baseVersion: 0, fields: { newWordLimit: 5 } } }],
  ...over,
})

describe('parsePushPage', () => {
  it('returns a clean page, dropping fields it does not know', () => {
    const raw = { ...page({ events: [event({ extra: 1 })] }), note: 'ignored' }
    expect(parsePushPage(raw)).toEqual({ ok: true, value: page() })
  })

  it('keeps deleted on a document write only when it was sent', () => {
    const parsed = parsePushPage(
      page({
        documents: [
          { type: 'word_flag', key: 'c:hello-1', patch: { baseVersion: 2, fields: {}, deleted: true } },
          { type: 'word_flag', key: 'c:hello-2', patch: { baseVersion: 0, fields: { flag: 'known' } } },
        ],
      }),
    )
    expect(parsed.ok && parsed.value.documents.map((d) => d.patch)).toEqual([
      { baseVersion: 2, fields: {}, deleted: true },
      { baseVersion: 0, fields: { flag: 'known' } },
    ])
  })

  it.each([
    ['something that is not an object', 'push'],
    ['a missing pushId', page({ pushId: undefined })],
    ['a fractional clientNow', page({ clientNow: 1.5 })],
    ['a lastPage that is not a boolean', page({ lastPage: 'yes' })],
    ['events that are not a list', page({ events: {} })],
    ['more events than a page holds', page({ events: Array.from({ length: SYNC_PAGE_SIZE + 1 }, (_, i) => event({ reviewId: `r-${i}`, deviceSeq: i + 1 })) })],
    ['more documents than a page holds', page({ documents: Array.from({ length: MAX_PAGE_DOCUMENTS + 1 }, () => ({ type: 'settings', key: '', patch: { baseVersion: 0, fields: {} } })) })],
    ['an impossible time-zone offset', page({ events: [event({ clientTzOffsetMin: 900 })] })],
    ['a fractional time-zone offset', page({ events: [event({ clientTzOffsetMin: 90.5 })] })],
    ['an unknown mode', page({ events: [event({ mode: 'typing' })] })],
    ['a grade of 5', page({ events: [event({ grade: 5 })] })],
    ['a negative latency', page({ events: [event({ latencyMs: -1 })] })],
    ['a latency over an hour', page({ events: [event({ latencyMs: MAX_LATENCY_MS + 1 })] })],
    ['a word that is not a word ID', page({ events: [event({ wordId: 'hello' })] })],
    ["another device's event", page({ events: [event({ deviceId: 'dev-b' })] })],
    ['a practice flag that is not a boolean', page({ events: [event({ practice: 'no' })] })],
    ['a reviewId that is not an ID', page({ events: [event({ reviewId: 'r 1' })] })],
    ['an impossible date', page({ dayComplete: [{ localDate: '2026-02-30', ruleVersion: 'r1' }] })],
    ['a document patch without fields', page({ documents: [{ type: 'settings', key: '', patch: { baseVersion: 0 } }] })],
    ['a negative base version', page({ documents: [{ type: 'settings', key: '', patch: { baseVersion: -1, fields: {} } }] })],
    ['a deleted flag that is not a boolean', page({ documents: [{ type: 'word_flag', key: 'c:a', patch: { baseVersion: 0, fields: {}, deleted: 1 } }] })],
  ])('refuses %s', (_, raw) => {
    expect(parsePushPage(raw)).toMatchObject({ ok: false })
  })

  it('names what is wrong', () => {
    expect(parsePushPage(page({ events: [event(), event({ reviewId: 'r-2', grade: 0 })] }))).toEqual({
      ok: false,
      errors: ['events[1].grade is invalid'],
    })
  })
})

describe('protocolVersionOf', () => {
  it('reads the version from anything shaped like a request, and nothing else', () => {
    expect(protocolVersionOf({ protocolVersion: 0, whatever: true })).toBe(0)
    expect(protocolVersionOf({ protocolVersion: 3 })).toBe(3)
    expect(protocolVersionOf({ protocolVersion: '1' })).toBeNull()
    expect(protocolVersionOf(null)).toBeNull()
    expect(protocolVersionOf([1])).toBeNull()
  })
})

describe('parsePullRequest', () => {
  it('returns a clean request', () => {
    expect(parsePullRequest({ protocolVersion: 1, deviceId: 'dev-a', documentsSince: 4, extra: true })).toEqual({
      ok: true,
      value: { protocolVersion: 1, deviceId: 'dev-a', documentsSince: 4 },
    })
  })

  it('refuses a negative cursor and a missing device', () => {
    expect(parsePullRequest({ protocolVersion: 1, deviceId: 'dev-a', documentsSince: -1 })).toMatchObject({ ok: false })
    expect(parsePullRequest({ protocolVersion: 1, documentsSince: 0 })).toMatchObject({ ok: false })
  })
})
