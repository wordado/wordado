import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { classifyEvents, dayCounts, mergeSummaries, summarizeDays, type DaySummary } from './activity'
import { compareEvents, replay, type ReplayEvent } from './replay'
import { localDay } from './scheduler'
import { Grade, type Mode } from './types'
import { corpusWordId, userWordId, type WordId } from './wordId'

/** Sofia winter time: minutes to ADD to UTC. */
const TZ = 120
const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 0, 5 + day, hour, minute) - TZ * 60_000
const day = (n: number) => localDay(at(n, 12), TZ)
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

const kinds = (events: ReplayEvent[], options = {}) =>
  classifyEvents(events, options).map((c) => [c.event.reviewId, c.kind] as const)

describe('classifyEvents', () => {
  it("tells a word's first review, its first of a later day, and same-day repeats apart", () => {
    const a = ev(bank, Grade.Good, at(0, 10))
    const b = ev(bank, Grade.Again, at(2, 10))
    const c = ev(bank, Grade.Again, at(2, 10, 15))
    const d = ev(bank, Grade.Good, at(2, 10, 30))
    const e = ev(bank, Grade.Good, at(5, 10))
    expect(kinds([a, b, c, d, e])).toEqual([
      [a.reviewId, 'new'],
      [b.reviewId, 'review'],
      [c.reviewId, 'repeat'],
      [d.reviewId, 'repeat'],
      [e.reviewId, 'review'],
    ])
  })

  it('classifies practice and every matching answer as practice', () => {
    const a = ev(bank, Grade.Good, at(0, 10), { practice: true })
    const b = ev(bank, Grade.Good, at(0, 11), { mode: 'matching' as Mode })
    const c = ev(bank, Grade.Good, at(0, 12))
    expect(kinds([a, b, c])).toEqual([[a.reviewId, 'practice'], [b.reviewId, 'practice'], [c.reviewId, 'new']])
  })

  it('is a function of the set of events: order and duplicates change nothing', () => {
    const a = ev(bank, Grade.Good, at(0, 10))
    const b = ev(bank, Grade.Good, at(1, 10))
    expect(kinds([b, a, { ...a }])).toEqual(kinds([a, b]))
  })

  it('counts a day in the time zone the answer was given in', () => {
    const a = ev(bank, Grade.Good, at(0, 10))
    const lateEvening = Date.UTC(2026, 0, 5, 22, 30) // 00:30 on day 1 in Sofia, still day 0 in UTC
    expect(kinds([a, ev(bank, Grade.Good, lateEvening)])[1]?.[1]).toBe('review')
    expect(kinds([a, ev(bank, Grade.Good, lateEvening, { clientTzOffsetMin: 0 })])[1]?.[1]).toBe('repeat')
  })

  it('continues from a prior state: a pulled word is not new, and its day is known', () => {
    const before = ev(bank, Grade.Good, at(0, 10))
    const prior = replay([before])
    const sameDay = ev(bank, Grade.Good, at(0, 15))
    const nextDay = ev(bank, Grade.Good, at(1, 15))
    expect(kinds([sameDay], { prior })).toEqual([[sameDay.reviewId, 'repeat']])
    expect(kinds([nextDay], { prior })).toEqual([[nextDay.reviewId, 'review']])
    expect(kinds([ev(river, Grade.Good, at(1, 15))], { prior })[0]?.[1]).toBe('new')
  })

  it("groups a merged user word's events under the entry", () => {
    const a = ev(mine, Grade.Good, at(0, 10))
    const b = ev(bank, Grade.Good, at(1, 10))
    const classified = classifyEvents([a, b], { aliases: new Map<WordId, WordId>([[mine, bank]]) })
    expect(classified.map((c) => c.wordId)).toEqual([bank, bank])
    expect(classified.map((c) => c.kind)).toEqual(['new', 'review'])
  })

  it("treats a prior lastReviewDay later than today's (a device ahead) as a same-day repeat, not a review", () => {
    // A Good rated at 12:30 Sofia time, replayed on a device set to UTC+14, where it is already 00:30 tomorrow.
    const before = ev(bank, Grade.Again, at(0, 12, 30), { clientTzOffsetMin: 14 * 60 })
    const prior = replay([before])
    expect(prior.get(bank)?.lastReviewDay).toBe(day(0) + 1)
    const sameInstantOnSofia = ev(bank, Grade.Good, at(0, 12, 30))
    expect(kinds([sameInstantOnSofia], { prior })).toEqual([[sameInstantOnSofia.reviewId, 'repeat']])
  })

  it('resolves a reviewId collision to the payload earliest in compareEvents order, whatever the array order', () => {
    const early = ev(bank, Grade.Good, at(0, 10))
    const late = { ...ev(bank, Grade.Again, at(2, 10)), reviewId: early.reviewId }
    const forward = classifyEvents([early, late])
    const backward = classifyEvents([late, early])
    expect(forward).toEqual(backward)
    expect(forward).toHaveLength(1)
    expect(forward[0]?.day).toBe(day(0))
  })

  it('classifies the same whether the log is passed whole or split into a prior and the events since, when every earlier event sorts first', () => {
    const words = [bank, river, mine]
    const arbEvent = fc.record({
      word: fc.integer({ min: 0, max: words.length - 1 }),
      grade: fc.constantFrom(Grade.Again, Grade.Hard, Grade.Good, Grade.Easy),
      day: fc.integer({ min: 0, max: 8 }),
      hour: fc.integer({ min: 0, max: 20 }),
      deviceSeq: fc.integer({ min: 1, max: 1_000 }),
    })
    fc.assert(
      fc.property(
        fc.uniqueArray(arbEvent, { selector: (e) => e.deviceSeq, minLength: 2, maxLength: 20 }),
        fc.integer({ min: 0, max: 1_000 }),
        (raw, splitPick) => {
          const events = raw.map((e) => ev(words[e.word]!, e.grade, at(e.day, e.hour), { deviceSeq: e.deviceSeq }))
          const sorted = [...events].sort(compareEvents)
          const splitIndex = splitPick % (sorted.length + 1)
          const head = sorted.slice(0, splitIndex)
          const tail = sorted.slice(splitIndex)
          const whole = kinds(sorted)
          const split = [...kinds(head), ...kinds(tail, { prior: replay(head) })]
          expect(split).toEqual(whole)
        },
      ),
    )
  })
})

describe('dayCounts', () => {
  it('counts one review per word per day, new words apart, and everything answered', () => {
    const events = [
      ev(bank, Grade.Good, at(0, 10)),
      ev(river, Grade.Good, at(0, 10)),
      ev(bank, Grade.Again, at(1, 9)),
      ev(bank, Grade.Again, at(1, 9, 15)),
      ev(bank, Grade.Good, at(1, 9, 30)),
      ev(river, Grade.Good, at(1, 9)),
      ev(mine, Grade.Good, at(1, 10)),
      ev(river, Grade.Good, at(1, 11), { mode: 'matching' as Mode, practice: true }),
    ]
    const classified = classifyEvents(events)
    expect(dayCounts(classified, day(0))).toEqual({ reviewsDone: 0, newWordsDone: 2, practiceDone: 0, answered: 2 })
    expect(dayCounts(classified, day(1))).toEqual({ reviewsDone: 2, newWordsDone: 1, practiceDone: 1, answered: 6 })
    expect(dayCounts(classified, day(2))).toEqual({ reviewsDone: 0, newWordsDone: 0, practiceDone: 0, answered: 0 })
  })
})

describe('summarizeDays and mergeSummaries', () => {
  it('summarises reviews, first-attempt successes, new words, and every answer and practice answer per local day', () => {
    const events = [
      ev(bank, Grade.Good, at(0, 10)),
      ev(river, Grade.Good, at(0, 10)),
      ev(bank, Grade.Again, at(2, 9)),
      ev(bank, Grade.Good, at(2, 9, 30)), // same-day relearn: not a first attempt, still answered
      ev(river, Grade.Hard, at(2, 9)),
      ev(river, Grade.Good, at(2, 11), { practice: true }),
    ]
    const summary = summarizeDays(classifyEvents(events))
    expect(summary.get(day(0))).toEqual({ day: day(0), reviews: 0, successes: 0, newWords: 2, answered: 2, practice: 0 })
    expect(summary.get(day(2))).toEqual({ day: day(2), reviews: 2, successes: 1, newWords: 0, answered: 4, practice: 1 })
    expect(summary.has(day(1))).toBe(false)
  })

  it('gives a day with only practice answers a summary row', () => {
    const events = [ev(bank, Grade.Good, at(0, 10), { practice: true }), ev(river, Grade.Good, at(0, 11), { mode: 'matching' as Mode })]
    const summary = summarizeDays(classifyEvents(events))
    expect(summary.get(day(0))).toEqual({ day: day(0), reviews: 0, successes: 0, newWords: 0, answered: 2, practice: 2 })
  })

  it('adds the pulled summary and the days recorded since', () => {
    const pulled: DaySummary[] = [{ day: day(0), reviews: 5, successes: 4, newWords: 1, answered: 7, practice: 1 }]
    const local: DaySummary[] = [
      { day: day(0), reviews: 1, successes: 1, newWords: 0, answered: 2, practice: 1 },
      { day: day(1), reviews: 2, successes: 0, newWords: 3, answered: 5, practice: 0 },
    ]
    const merged = mergeSummaries(pulled, local)
    expect(merged.get(day(0))).toEqual({ day: day(0), reviews: 6, successes: 5, newWords: 1, answered: 9, practice: 2 })
    expect(merged.get(day(1))).toEqual(local[1])
  })
})
