import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compareEvents, replay, resolveAlias, type ReplayEvent } from './replay'
import { applyGrade, DAY_MS } from './scheduler'
import { Grade, type Mode } from './types'
import { corpusWordId, userWordId, type WordId } from './wordId'

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0)
/** Sofia winter time: minutes to ADD to UTC. */
const TZ = 120
const bank = corpusWordId('en-000010')
const river = corpusWordId('en-000011')
const mine = userWordId('11111111-2222-4333-8444-555555555555')

let seq = 0
function ev(wordId: WordId, grade: Grade, effectiveTs: number, over: Partial<ReplayEvent> = {}): ReplayEvent {
  seq += 1
  return {
    reviewId: `r${seq}`,
    wordId,
    mode: 'multiple_choice',
    grade,
    practice: false,
    effectiveTs,
    clientTzOffsetMin: TZ,
    deviceId: 'dev-a',
    deviceSeq: seq,
    ...over,
  }
}

describe('replay', () => {
  it('folds each word’s events through the scheduler in time order', () => {
    const a = ev(bank, Grade.Good, T0)
    const b = ev(bank, Grade.Hard, T0 + 3 * DAY_MS)
    const expected = applyGrade(applyGrade(null, bank, Grade.Good, T0, TZ), bank, Grade.Hard, T0 + 3 * DAY_MS, TZ)
    expect(replay([b, a]).get(bank)).toEqual(expected)
  })

  it('counts elapsed days in the time zone the answer was given in', () => {
    const evening = Date.UTC(2026, 0, 5, 22, 0) // 00:00 local the next day at +120
    const morning = Date.UTC(2026, 0, 6, 6, 0)
    const sofia = replay([ev(bank, Grade.Good, T0), ev(bank, Grade.Good, evening, { clientTzOffsetMin: TZ })])
    const utc = replay([ev(river, Grade.Good, T0, { clientTzOffsetMin: 0 }), ev(river, Grade.Good, evening, { clientTzOffsetMin: 0 })])
    expect(sofia.get(bank)?.stability).toBeGreaterThan(utc.get(river)?.stability ?? 0)
    expect(sofia.get(bank)?.lastReviewDay).toBe(replay([ev(bank, Grade.Good, morning)]).get(bank)?.lastReviewDay)
  })

  it('keeps words independent', () => {
    const states = replay([ev(bank, Grade.Good, T0), ev(river, Grade.Again, T0 + 1)])
    expect(states.get(bank)?.reps).toBe(1)
    expect(states.get(river)?.lastGrade).toBe(Grade.Again)
  })

  it('skips practice events entirely', () => {
    const states = replay([ev(bank, Grade.Good, T0), ev(bank, Grade.Again, T0 + 60_000, { practice: true })])
    expect(states.get(bank)).toEqual(applyGrade(null, bank, Grade.Good, T0, TZ))
    expect(replay([ev(river, Grade.Good, T0, { practice: true })]).has(river)).toBe(false)
  })

  it('never lets a matching event alter review state, even when it is not flagged practice', () => {
    const matching = { mode: 'matching' as Mode, practice: false }
    const states = replay([ev(bank, Grade.Good, T0), ev(bank, Grade.Again, T0 + 60_000, matching)])
    expect(states.get(bank)).toEqual(applyGrade(null, bank, Grade.Good, T0, TZ))
    expect(replay([ev(river, Grade.Good, T0, matching)]).has(river)).toBe(false)
  })

  it('deduplicates on reviewId', () => {
    const a = ev(bank, Grade.Good, T0)
    expect(replay([a, { ...a }, a]).get(bank)?.reps).toBe(1)
  })

  it('resolves a reviewId collision the same way whatever the input order', () => {
    const a = ev(bank, Grade.Good, T0)
    const b: ReplayEvent = { ...a, grade: Grade.Again, effectiveTs: T0 + 2 * DAY_MS, deviceSeq: a.deviceSeq + 1 }
    expect(replay([a, b])).toEqual(replay([b, a]))
    expect(replay([a, b]).get(bank)?.lastGrade).toBe(Grade.Good)
  })

  it('groups a merged user word’s events under the corpus entry', () => {
    const aliases = new Map<WordId, WordId>([[mine, bank]])
    const states = replay([ev(mine, Grade.Good, T0), ev(bank, Grade.Good, T0 + 2 * DAY_MS)], aliases)
    expect(states.has(mine)).toBe(false)
    expect(states.get(bank)?.reps).toBe(2)
    expect(states.get(bank)?.introducedTs).toBe(T0)
  })

  it('regroups events under the user word when the alias is removed', () => {
    const events = [ev(mine, Grade.Good, T0), ev(bank, Grade.Good, T0 + 2 * DAY_MS)]
    const states = replay(events)
    expect(states.get(mine)?.reps).toBe(1)
    expect(states.get(bank)?.reps).toBe(1)
  })

  it('breaks timestamp ties by device, then by device sequence', () => {
    const x = ev(bank, Grade.Good, T0, { deviceId: 'dev-b', deviceSeq: 1 })
    const y = ev(bank, Grade.Again, T0, { deviceId: 'dev-a', deviceSeq: 9 })
    const z = ev(bank, Grade.Hard, T0, { deviceId: 'dev-a', deviceSeq: 2 })
    expect([x, y, z].sort(compareEvents)).toEqual([z, y, x])
  })
})

describe('resolveAlias', () => {
  it('follows chains and refuses cycles', () => {
    expect(resolveAlias(mine, new Map<WordId, WordId>([[mine, river], [river, bank]]))).toBe(bank)
    expect(() => resolveAlias(mine, new Map<WordId, WordId>([[mine, river], [river, mine]]))).toThrow(/cycle/)
  })
})

describe('replay convergence (spec §13)', () => {
  const words = [bank, river, mine] as const
  const eventArb = fc.record({
    reviewId: fc.uuid(),
    wordId: fc.constantFrom(...words),
    mode: fc.constantFrom<Mode>('flashcard', 'multiple_choice', 'listening_select', 'matching'),
    grade: fc.constantFrom(Grade.Again, Grade.Hard, Grade.Good, Grade.Easy),
    practice: fc.boolean(),
    // A narrow range forces timestamp ties, so the tie-breakers are exercised.
    effectiveTs: fc.integer({ min: 0, max: 40 }).map((n) => T0 + n * (DAY_MS / 4)),
    clientTzOffsetMin: fc.constantFrom(-300, 0, 120, 330),
    deviceId: fc.constantFrom('dev-a', 'dev-b', 'dev-c'),
    deviceSeq: fc.integer({ min: 1, max: 50 }),
  })
  const logArb = fc.uniqueArray(eventArb, { selector: (e) => e.reviewId, maxLength: 40 })

  it('gives the same state for any ordering and any duplication of the same events', () => {
    fc.assert(
      fc.property(logArb, fc.infiniteStream(fc.nat()), fc.boolean(), (log, noise, withAlias) => {
        const aliases = new Map<WordId, WordId>(withAlias ? [[mine, bank]] : [])
        const keys = noise[Symbol.iterator]()
        const shuffled = [...log, ...log.filter((_, i) => i % 3 === 0)]
          .map((event) => ({ event, key: keys.next().value as number }))
          .sort((a, b) => a.key - b.key)
          .map((x) => x.event)
        expect(replay(shuffled, aliases)).toEqual(replay(log, aliases))
      }),
    )
  })

  it('is the union: replaying two devices’ logs together equals replaying the merged log', () => {
    fc.assert(
      fc.property(logArb, (log) => {
        const a = log.filter((e) => e.deviceId === 'dev-a')
        const rest = log.filter((e) => e.deviceId !== 'dev-a')
        expect(replay([...rest, ...a])).toEqual(replay([...a, ...rest]))
      }),
    )
  })

  it('ignores matching answers however they are graded', () => {
    fc.assert(
      fc.property(logArb, (log) => {
        const scheduled = log.filter((e) => e.mode !== 'matching')
        expect(replay(log)).toEqual(replay(scheduled))
      }),
    )
  })
})
