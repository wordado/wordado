import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isAboveMark, rebase, type DeviceMarks } from './rebase'
import { replay, type ReplayEvent } from './replay'
import { DAY_MS } from './scheduler'
import { Grade } from './types'
import { corpusWordId, type WordId } from './wordId'

const T0 = Date.UTC(2026, 0, 5, 9, 0)
const TZ = 120
const w = (n: number) => corpusWordId(`en-${String(n).padStart(6, '0')}`)

function ev(wordId: WordId, deviceId: string, deviceSeq: number, effectiveTs: number, grade: Grade = Grade.Good): ReplayEvent {
  return {
    reviewId: `${deviceId}-${deviceSeq}`,
    wordId,
    mode: 'multiple_choice',
    grade,
    practice: false,
    effectiveTs,
    clientTzOffsetMin: TZ,
    deviceId,
    deviceSeq,
  }
}

describe('isAboveMark', () => {
  it('is above when newer than the device\'s mark or from a device the server has not seen', () => {
    const marks: DeviceMarks = new Map([['dev-a', 10]])
    expect(isAboveMark({ deviceId: 'dev-a', deviceSeq: 10 }, marks)).toBe(false)
    expect(isAboveMark({ deviceId: 'dev-a', deviceSeq: 11 }, marks)).toBe(true)
    expect(isAboveMark({ deviceId: 'dev-b', deviceSeq: 1 }, marks)).toBe(true)
  })
})

describe('rebase', () => {
  it('re-applies the answers the server has not seen on top of its state', () => {
    const synced = [ev(w(1), 'dev-a', 1, T0), ev(w(2), 'dev-a', 2, T0)]
    const local = [...synced, ev(w(1), 'dev-a', 3, T0 + 2 * DAY_MS, Grade.Again), ev(w(3), 'dev-a', 4, T0 + 2 * DAY_MS)]
    const server = replay(synced)
    const states = rebase(server, new Map([['dev-a', 2]]), local)
    expect(states).toEqual(replay(local))
    expect(states.get(w(1))?.lastGrade).toBe(Grade.Again)
    expect(states.has(w(3))).toBe(true)
  })

  it('takes the server\'s word for everything at or below the mark', () => {
    // The server saw a second device\'s review that this device never had.
    const other = ev(w(1), 'dev-b', 1, T0 + DAY_MS, Grade.Easy)
    const server = replay([ev(w(1), 'dev-a', 1, T0), other])
    const local = [ev(w(1), 'dev-a', 1, T0)]
    const states = rebase(server, new Map([['dev-a', 1], ['dev-b', 1]]), local)
    expect(states.get(w(1))).toEqual(server.get(w(1)))
  })

  it('drops the state of a tombstoned user word and keeps the rest', () => {
    const mine = corpusWordId('en-000009')
    const server = replay([ev(mine, 'dev-a', 1, T0), ev(w(1), 'dev-a', 2, T0)])
    const states = rebase(server, new Map([['dev-a', 2]]), [], new Map(), new Set([mine]))
    expect(states.has(mine)).toBe(false)
    expect(states.has(w(1))).toBe(true)
  })

  it('never loses an event above the mark, whatever the server included', () => {
    const arbEvent = fc.record({
      word: fc.integer({ min: 1, max: 4 }),
      seq: fc.integer({ min: 1, max: 30 }),
      day: fc.integer({ min: 0, max: 20 }),
    })
    fc.assert(
      fc.property(
        fc.uniqueArray(arbEvent, { selector: (e) => e.seq, maxLength: 30 }),
        fc.integer({ min: 0, max: 30 }),
        (raw, mark) => {
          const local = raw.map((e) => ev(w(e.word), 'dev-a', e.seq, T0 + e.day * DAY_MS))
          const synced = local.filter((e) => e.deviceSeq <= mark)
          const states = rebase(replay(synced), new Map([['dev-a', mark]]), local)
          const above = local.filter((e) => e.deviceSeq > mark)
          for (const word of new Set(local.map((e) => e.wordId))) {
            const expectedReps = synced.filter((e) => e.wordId === word).length + above.filter((e) => e.wordId === word).length
            expect(states.get(word)?.reps).toBe(expectedReps)
          }
        },
      ),
    )
  })
})
