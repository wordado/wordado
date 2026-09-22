import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { computeXp } from './xp'
import { DAY_MS } from './scheduler'
import {
  CLOCK_TOLERANCE_MS,
  DENSITY_MAX_EVENTS,
  openPushWindow,
  PLAUSIBILITY_FLOOR_MS,
  stampEvents,
  type PushWindow,
  type PushWindowInput,
} from './stamping'
import { Grade, type ReviewEvent } from './types'
import { corpusWordId, type WordId } from './wordId'

const w = (n: number) => corpusWordId(`en-${String(n).padStart(6, '0')}`)
const SERVER_NOW = Date.UTC(2026, 0, 10, 12, 0)
const CREATED = Date.UTC(2026, 0, 1, 9, 0)

let seq = 0
function ev(clientTs: number, over: Partial<ReviewEvent> = {}): ReviewEvent {
  seq += 1
  return {
    reviewId: `r${seq}`,
    wordId: w(seq),
    mode: 'multiple_choice',
    direction: 'en_to_l1',
    grade: Grade.Good,
    latencyMs: 2_000,
    practice: false,
    clientTs,
    clientTzOffsetMin: 120,
    deviceId: 'dev-a',
    deviceSeq: seq,
    schedulerVersion: 'test',
    ...over,
  }
}

function window(over: Partial<PushWindowInput> = {}): PushWindow {
  return openPushWindow({ clientNow: SERVER_NOW, serverNow: SERVER_NOW, lastAccepted: null, accountCreatedAt: CREATED, ...over })
}

describe('openPushWindow', () => {
  it('ignores a clock within the tolerance and corrects one outside it', () => {
    expect(window({ clientNow: SERVER_NOW + CLOCK_TOLERANCE_MS }).clockOffsetMs).toBe(0)
    expect(window({ clientNow: SERVER_NOW + CLOCK_TOLERANCE_MS + 1 }).clockOffsetMs).toBe(-(CLOCK_TOLERANCE_MS + 1))
    expect(window({ clientNow: SERVER_NOW - 3_600_000 }).clockOffsetMs).toBe(3_600_000)
  })

  it('bounds a known device by its last accepted event and a new one by the account\'s creation less a day', () => {
    const last = { deviceSeq: 40, effectiveTs: SERVER_NOW - DAY_MS }
    expect(window({ lastAccepted: last })).toMatchObject({ lowerBound: last.effectiveTs, upperBound: SERVER_NOW })
    expect(window().lowerBound).toBe(CREATED - DAY_MS)
  })
})

describe('stampEvents', () => {
  it('corrects a fast clock as a whole, keeps the spacing, and loses no XP', () => {
    const fast = 3_600_000
    const events = [ev(SERVER_NOW - 60_000 + fast), ev(SERVER_NOW - 30_000 + fast), ev(SERVER_NOW + fast)]
    const win = window({ clientNow: SERVER_NOW + fast })
    const stamped = stampEvents(events, win, SERVER_NOW)
    expect(stamped.map((e) => e.effectiveTs)).toEqual([SERVER_NOW - 60_000, SERVER_NOW - 30_000, SERVER_NOW])
    expect(stamped.every((e) => e.xpEligible)).toBe(true)
    expect(computeXp(stamped).total).toBe(computeXp(stamped.map((e) => ({ ...e, xpEligible: true }))).total)
  })

  it('leaves an in-window event alone', () => {
    const [s] = stampEvents([ev(SERVER_NOW - 5_000)], window(), SERVER_NOW + 10)
    expect(s).toMatchObject({ effectiveTs: SERVER_NOW - 5_000, receivedAt: SERVER_NOW + 10, xpEligible: true })
  })

  it('accepts a never-seen device and a carried-over demo studied before the account existed', () => {
    const demo = [ev(CREATED - 6 * 3_600_000), ev(CREATED - 3_600_000)]
    const stamped = stampEvents(demo, window(), SERVER_NOW)
    expect(stamped.map((e) => e.effectiveTs)).toEqual(demo.map((e) => e.clientTs))
    expect(stamped.every((e) => e.xpEligible)).toBe(true)
  })

  it('clamps only what is left outside the window, individually, and marks those XP-ineligible', () => {
    const last = { deviceSeq: 0, effectiveTs: SERVER_NOW - DAY_MS }
    const tooOld = ev(SERVER_NOW - 3 * DAY_MS)
    const fine = ev(SERVER_NOW - 3_600_000)
    const future = ev(SERVER_NOW + 2 * DAY_MS)
    const stamped = stampEvents([tooOld, fine, future], window({ lastAccepted: last }), SERVER_NOW)
    expect(stamped.map((e) => [e.effectiveTs, e.xpEligible])).toEqual([
      [last.effectiveTs, false],
      [fine.clientTs, true],
      [SERVER_NOW, false],
    ])
  })

  it('restores device_seq order after clamping and does not penalise the events it moved for that', () => {
    const last = { deviceSeq: 0, effectiveTs: SERVER_NOW - DAY_MS }
    const a = ev(SERVER_NOW - 3 * DAY_MS) // clamped up to the lower bound
    const b = ev(SERVER_NOW - 2 * DAY_MS) // clamped up as well: same bound, later seq
    const c = ev(SERVER_NOW - DAY_MS - 1) // just below the bound: clamped
    const d = ev(SERVER_NOW - 3_600_000) // fine
    const stamped = stampEvents([d, c, b, a], window({ lastAccepted: last }), SERVER_NOW)
    expect(stamped.map((e) => e.reviewId)).toEqual([a, b, c, d].map((e) => e.reviewId))
    for (let i = 1; i < stamped.length; i += 1) {
      expect(stamped[i]!.effectiveTs).toBeGreaterThanOrEqual(stamped[i - 1]!.effectiveTs)
    }
    expect(stamped.map((e) => e.xpEligible)).toEqual([false, false, false, true])
  })

  it('makes a device\'s timestamps non-decreasing without marking the moved event', () => {
    const a = ev(SERVER_NOW - 1_000, { deviceSeq: 100 })
    const b = ev(SERVER_NOW - 5_000, { deviceSeq: 101 }) // the clock went back between two answers
    const stamped = stampEvents([a, b], window(), SERVER_NOW)
    expect(stamped.map((e) => e.effectiveTs)).toEqual([SERVER_NOW - 1_000, SERVER_NOW - 1_000])
    expect(stamped.map((e) => e.xpEligible)).toEqual([true, true])
  })

  it('gives every page of one push the same window, whenever it arrives', () => {
    const win = window({ clientNow: SERVER_NOW + 3_600_000 })
    const page1 = stampEvents([ev(SERVER_NOW - 60_000 + 3_600_000)], win, SERVER_NOW)
    const page2 = stampEvents([ev(SERVER_NOW - 30_000 + 3_600_000)], win, SERVER_NOW + 20_000)
    expect(page1[0]!.effectiveTs).toBe(SERVER_NOW - 60_000)
    expect(page2[0]!.effectiveTs).toBe(SERVER_NOW - 30_000)
    expect(page2[0]!.receivedAt).toBe(SERVER_NOW + 20_000)
  })

  it('is a pure function of the page and the window', () => {
    const events = [ev(SERVER_NOW - 3 * DAY_MS), ev(SERVER_NOW - 1_000)]
    expect(stampEvents(events, window(), SERVER_NOW)).toEqual(stampEvents(events, window(), SERVER_NOW))
  })

  it('marks an implausibly fast answer XP-ineligible but stamps it like any other', () => {
    const fast = ev(SERVER_NOW - 1_000, { latencyMs: PLAUSIBILITY_FLOOR_MS.multiple_choice - 1 })
    const ok = ev(SERVER_NOW - 500, { latencyMs: PLAUSIBILITY_FLOOR_MS.multiple_choice })
    const [s1, s2] = stampEvents([fast, ok], window(), SERVER_NOW)
    expect(s1).toMatchObject({ effectiveTs: fast.clientTs, xpEligible: false })
    expect(s2).toMatchObject({ effectiveTs: ok.clientTs, xpEligible: true })
  })

  it('marks answers beyond the density ceiling, measured on effective time, not on the push', () => {
    const start = SERVER_NOW - 3_600_000
    const burst = Array.from({ length: DENSITY_MAX_EVENTS + 5 }, (_, i) => ev(start + i * 500))
    const stamped = stampEvents(burst, window(), SERVER_NOW)
    expect(stamped.filter((e) => !e.xpEligible)).toHaveLength(5)
    expect(stamped.slice(0, DENSITY_MAX_EVENTS).every((e) => e.xpEligible)).toBe(true)
    // A week's backlog flushed in one push, at a human pace, is all eligible.
    const backlog = Array.from({ length: 300 }, (_, i) => ev(SERVER_NOW - 7 * DAY_MS + i * 5_000))
    expect(stampEvents(backlog, window(), SERVER_NOW).every((e) => e.xpEligible)).toBe(true)
  })

  it('keeps every event inside the window and in per-device order, for any page', () => {
    const arbEvent = fc.record({
      clientTs: fc.integer({ min: SERVER_NOW - 30 * DAY_MS, max: SERVER_NOW + 30 * DAY_MS }),
      deviceId: fc.constantFrom('dev-a', 'dev-b'),
      deviceSeq: fc.integer({ min: 1, max: 1_000 }),
    })
    const arbWindow = fc.record({
      clientNow: fc.integer({ min: SERVER_NOW - DAY_MS, max: SERVER_NOW + DAY_MS }),
      lastTs: fc.option(fc.integer({ min: CREATED, max: SERVER_NOW }), { nil: null }),
    })
    fc.assert(
      fc.property(fc.array(arbEvent, { maxLength: 40 }), arbWindow, (events, { clientNow, lastTs }) => {
        const win = window({ clientNow, lastAccepted: lastTs === null ? null : { deviceSeq: 0, effectiveTs: lastTs } })
        const stamped = stampEvents(events.map((e) => ev(e.clientTs, e)), win, SERVER_NOW)
        expect(stamped).toHaveLength(events.length)
        for (let i = 0; i < stamped.length; i += 1) {
          const s = stamped[i]!
          expect(s.effectiveTs).toBeGreaterThanOrEqual(win.lowerBound)
          expect(s.effectiveTs).toBeLessThanOrEqual(win.upperBound)
          const prev = stamped[i - 1]
          if (prev && prev.deviceId === s.deviceId) {
            expect(prev.deviceSeq).toBeLessThanOrEqual(s.deviceSeq)
            expect(prev.effectiveTs).toBeLessThanOrEqual(s.effectiveTs)
          }
        }
      }),
    )
  })
})
