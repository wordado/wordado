import { describe, expect, it } from 'vitest'
import { classifyEvents } from './activity'
import { utcDay } from './calendar'
import { localDay } from './scheduler'
import { Grade, type Mode } from './types'
import { corpusWordId, type WordId } from './wordId'
import { awardXp, computeXp, DAILY_XP_CAP, XP_AMOUNTS, type XpEvent } from './xp'
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

describe('awardXp', () => {
  // Day 0 passes the cap (105 new words), with a same-day repeat and a practice
  // answer; day 1 has reviews and one ineligible answer.
  function log(): XpEvent[] {
    const out: XpEvent[] = []
    for (let n = 1; n <= 105; n += 1) out.push(ev(w(n), Grade.Good, at(0, 8) + n * 1000))
    out.push(ev(w(1), Grade.Again, at(0, 9)))
    out.push(ev(w(2), Grade.Good, at(0, 9, 5), { practice: true }))
    for (let n = 1; n <= 20; n += 1) out.push(ev(w(n), Grade.Good, at(1, 8) + n * 1000))
    out.push(ev(w(200), Grade.Good, at(1, 9), { xpEligible: false }))
    return out
  }

  it('is computeXp over the classified log', () => {
    const events = log()
    expect(awardXp(classifyEvents(events))).toEqual(computeXp(events))
  })

  it('gives a UTC day the same awards computed alone as computed with the whole log', () => {
    const classified = classifyEvents(log())
    const whole = awardXp(classified)
    const days = new Set(classified.map((c) => utcDay(c.event.effectiveTs)))
    expect(days.size).toBe(2)
    for (const day of days) {
      const alone = awardXp(classified.filter((c) => utcDay(c.event.effectiveTs) === day))
      for (const [reviewId, amount] of alone.awards) expect(amount).toBe(whole.awards.get(reviewId))
      expect(alone.byUtcDay.get(day)).toBe(whole.byUtcDay.get(day))
    }
  })

  it('does not depend on the order of its input', () => {
    const classified = classifyEvents(log())
    expect(awardXp([...classified].reverse())).toEqual(awardXp(classified))
  })

  it('spends the cap and pays nothing to an ineligible answer', () => {
    const events = log()
    const xp = awardXp(classifyEvents(events))
    expect(xp.byUtcDay.get(utcDay(at(0, 8)))).toBe(DAILY_XP_CAP)
    expect(xp.awards.get(events[events.length - 1]!.reviewId)).toBe(0)
  })
})
