import { describe, expect, it } from 'vitest'
import { localDay } from './scheduler'
import { Grade, type Mode } from './types'
import { corpusWordId, type WordId } from './wordId'
import { computeXp, DAILY_XP_CAP, XP_AMOUNTS, type XpEvent } from './xp'
import { replay } from './replay'

/** Sofia winter time: minutes to ADD to UTC. */
const TZ = 120
const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 0, 5 + day, hour, minute) - TZ * 60_000
const w = (n: number) => corpusWordId(`en-${String(n).padStart(6, '0')}`)

let seq = 0
function ev(wordId: WordId, grade: Grade, effectiveTs: number, over: Partial<XpEvent> = {}): XpEvent {
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

describe('computeXp', () => {
  it('pays a fixed amount for a new word and for a due review, whatever the grade', () => {
    const a = ev(w(1), Grade.Again, at(0, 10))
    const b = ev(w(1), Grade.Easy, at(3, 10))
    const xp = computeXp([a, b])
    expect(xp.awards.get(a.reviewId)).toBe(XP_AMOUNTS.new)
    expect(xp.awards.get(b.reviewId)).toBe(XP_AMOUNTS.review)
    expect(xp.total).toBe(XP_AMOUNTS.new + XP_AMOUNTS.review)
  })

  it('pays a word answered Again five times in a day once', () => {
    const first = ev(w(1), Grade.Good, at(0, 10))
    const day = [1, 2, 3, 4, 5].map((k) => ev(w(1), Grade.Again, at(3, 10, k * 10)))
    const xp = computeXp([first, ...day])
    expect(day.map((e) => xp.awards.get(e.reviewId))).toEqual([XP_AMOUNTS.review, 0, 0, 0, 0])
  })

  it('pays a reduced amount for practice and for every matching answer', () => {
    const a = ev(w(1), Grade.Good, at(0, 10), { practice: true })
    const b = ev(w(2), Grade.Good, at(0, 10), { mode: 'matching' as Mode })
    const xp = computeXp([a, b])
    expect(xp.awards.get(a.reviewId)).toBe(XP_AMOUNTS.practice)
    expect(xp.awards.get(b.reviewId)).toBe(XP_AMOUNTS.practice)
    expect(XP_AMOUNTS.practice).toBeLessThan(XP_AMOUNTS.review)
  })

  it('pays nothing for an XP-ineligible event', () => {
    const a = ev(w(1), Grade.Good, at(0, 10), { xpEligible: false })
    const b = ev(w(2), Grade.Good, at(0, 10), { xpEligible: true })
    const c = ev(w(3), Grade.Good, at(0, 10)) // unstamped: an outbox event, shown as eligible
    const xp = computeXp([a, b, c])
    expect(xp.awards.get(a.reviewId)).toBe(0)
    expect(xp.awards.get(b.reviewId)).toBe(XP_AMOUNTS.new)
    expect(xp.awards.get(c.reviewId)).toBe(XP_AMOUNTS.new)
  })

  it('caps a UTC day and lets the next UTC day start afresh', () => {
    const perDay = Math.ceil(DAILY_XP_CAP / XP_AMOUNTS.new) + 3
    // 23:00 UTC on day 0 (01:00 local day 1): every event on one UTC day.
    const dayOne = Array.from({ length: perDay }, (_, i) => ev(w(i + 1), Grade.Good, Date.UTC(2026, 0, 5, 23, 0, i)))
    // 00:30 UTC on day 1.
    const after = ev(w(999), Grade.Good, Date.UTC(2026, 0, 6, 0, 30))
    const xp = computeXp([...dayOne, after])
    expect(xp.byUtcDay.get(localDay(Date.UTC(2026, 0, 5, 23), 0))).toBe(DAILY_XP_CAP)
    expect(xp.awards.get(after.reviewId)).toBe(XP_AMOUNTS.new)
    expect(xp.total).toBe(DAILY_XP_CAP + XP_AMOUNTS.new)
  })

  it('is recomputed, not incremented: a late event from another device cannot slip past the cap', () => {
    const n = DAILY_XP_CAP / XP_AMOUNTS.new
    const dayOne = Array.from({ length: n }, (_, i) => ev(w(i + 1), Grade.Good, Date.UTC(2026, 0, 5, 12, 0, i)))
    const late = ev(w(500), Grade.Good, Date.UTC(2026, 0, 5, 8, 0), { deviceId: 'dev-b', deviceSeq: 1 })
    expect(computeXp([...dayOne, late]).total).toBe(DAILY_XP_CAP)
    expect(computeXp([...dayOne, late])).toEqual(computeXp([late, ...dayOne]))
  })

  it('continues from a pulled state, so a reviewed word is not paid as new twice', () => {
    const before = ev(w(1), Grade.Good, at(0, 10))
    const prior = replay([before])
    const today = ev(w(1), Grade.Good, at(2, 10))
    expect(computeXp([today], { prior }).awards.get(today.reviewId)).toBe(XP_AMOUNTS.review)
  })
})
