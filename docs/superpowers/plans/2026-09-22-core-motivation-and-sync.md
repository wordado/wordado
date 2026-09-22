# Core Rules: Motivation and Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the `core` package's rules for Phase 1a: XP, streaks, event stamping, the rebase rule, versioned-document merge, the entitlement and its capability check, the progress metrics, and placement-test scoring — all pure, all derived from events or documents, none reading a clock.

**Architecture:** Every rule here is a pure function over the event log, derived review state, or a document, in the same package and style as plan 1. One classification of answers (`new` / `review` / `repeat` / `practice`) feeds XP, the daily counts session composition needs, the daily summary a pull carries, and the retention rate, so the server and every client count the same way. Stamping and document merge are the server's rules, written once here so that the server (plan 5) is thin and the tests are unit tests.

**Tech Stack:** Node 24, pnpm 12, TypeScript 7, Vitest 5, fast-check 4, ts-fsrs 5.4.2 (FSRS-6). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md` — this plan implements §4.3 (the rebase rule), §7.2 (placement scoring, unit markers), §8.3 (retention rate, level completion, daily summary), §8.4 (streaks, day_complete), §8.7 (XP), §8.8 (entitlement, capability check), §9.2 (effective time, versioned and server-owned documents, tombstones), and the XP-eligibility rules of §10. It is plan 2 of 8; see `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`, whose "Contracts `core` hands to the later plans" section lists the edits this plan makes to plan 1's code.

> **Revised 2026-09-22 after the whole-branch review.** The review changed `stampEvents` to thread a per-device carry across the pages of a push (its stamps must not depend on pagination), made `classifyEvents` treat a last day later than the answer's as a same-day repeat (as `composeSession` and the scheduler do), made `freezesLeft` count only misses inside the run, and added `answered` and `practice` to the daily summary so a device can rebuild today's counts after a pull. The task bodies below show the code as first planned; the merged code in `core/src` is the record.

## Global Constraints

- `core` is pure: no I/O, no framework, no platform APIs (spec §4.1). `tsconfig.base.json` sets `"lib": ["ES2022"]` and `"types": []`, so `fetch`, `process`, `document` and `localStorage` do not compile. Do not loosen it. `Date.UTC`, `new Date(ms)` and the UTC getters are calendar arithmetic and are allowed; `Date.now()` and `new Date()` are not.
- `core` never reads the clock, never calls `Math.random`, and never depends on the host locale. Times arrive as arguments (epoch milliseconds, `number`); randomness arrives as an `Rng`.
- A day is the learner's **local calendar day** (spec §8.4): `localDay(ts, clientTzOffsetMin)`, an integer count of days since the epoch. The XP cap alone counts in **UTC days** (spec §8.7), so no client setting can move it.
- Events are immutable. Replay, classification and XP never rewrite them; `effectiveTs` is never recomputed once assigned (spec §9.2). XP is recomputed from events, never incremented (spec §8.5, §10).
- Anti-cheat governs XP, never learning data (spec §10): an implausible event is stamped and replayed like any other and only its `xpEligible` differs.
- Streaks are a pure function of the set of `day_complete` dates (spec §8.4): no rule here re-derives whether a past day was complete.
- Adding a scheduling rule is a `SCHEDULER_VERSION` bump. This plan adds two derived fields to `ReviewState` and changes no scheduling number: the version stays `fsrs6-tsfsrs5.4.2-r2`, and the pin test proves it.
- Code style: no semicolons, single quotes, 2-space indent, named exports only, `readonly` on every interface field. Each new module has one test file beside it.
- Every task ends with `pnpm test` and `pnpm typecheck` green from the repository root.

## Tuning values settled here (spec §15)

| Item | Value | Where |
|---|---|---|
| XP per new word / due review / same-day repeat / practice answer | 10 / 10 / 0 / 2 | `xp.ts` |
| Daily XP cap, per UTC day | 1 000 | `xp.ts` |
| Streak freezes per calendar month | 2 | `streaks.ts` |
| Day-complete rule version | `r1` | `streaks.ts` |
| Clock-offset tolerance for stamping | 2 minutes | `stamping.ts` |
| Anti-cheat plausibility floor: flashcard / multiple choice / listening (select) / matching | 300 / 400 / 600 / 250 ms | `stamping.ts` |
| Event-density ceiling | 60 answers per device per 60 s of effective time | `stamping.ts` |
| Retention-rate window | trailing 30 days, today included | `progress.ts` |
| Unit complete / unit mastered | 80 % passed on a later day / 90 % mature (spec §7.2) | `progress.ts` |
| Entitlement `stale_after` | 24 hours after the pull | `entitlement.ts` |
| Free-tier enrichment quota | 20 lookups per day | `entitlement.ts` |
| Named capabilities | `collections.theme`, `collections.exam`, `capture.paste`, `capture.share`, `capture.import`, `capture.extension`, `forecast`, `streak.extra_freezes`, `enrichment` | `entitlement.ts` |
| Placement probe: words per band / right answers to pass | 8 / 6, starting at B1 | `placement.ts` |
| Placement test length | at most 24 words (3 probes × 8), usually 16–24 | `placement.ts` |

## Decisions recorded here

- **"First scheduled review of the day"** (spec §8.7) is counted in the learner's local day of the answer, the same day the scheduler counts a same-day relearn in. Only the cap is per UTC day.
- **Streak length counts frozen days.** A run extends back from today (or from yesterday, while today is unfinished) as long as every calendar month inside it holds at most two missed days. Freezes are therefore never "consumed" by a stored balance: they are the two misses a month tolerates. That definition is monotone — adding a `day_complete` date can only lengthen a streak — which is what §8.4 promises.
- **Day complete** means: at least one answer today, and either the capped due figure is finished or the daily goal is met. Words rated *Again* earlier today that are back for a retry do not hold the day open.
- **Stale documents merge trivially.** A patch names only changed fields, and for a field changed on both sides the later arrival wins (spec §9.2), so every named field is applied and every unnamed field is kept. `applyPatch` reports `merged: true` when the base was stale so the server can tell the client; the outcome is the same.
- **An outbox event's `effectiveTs` is its `clientTs`** until the server stamps it. `client-data` (plan 4) sets it when it builds `ReplayEvent`s from the outbox; `core` never fills it in.
- **The `plus` tier exists in the type only.** One tier is issued at launch (spec §8.8); the second is in the capability table so the fallback after `expiresAt` can be tested and introducing it later is a data change.

## File Structure

```
core/src/
  scheduler.ts     + introducedDay, passedOnLaterDay on ReviewState       (modify)
  session.ts       relearning group uses >=; SessionPlan.reviews comment  (modify)
  replay.ts        + ReplayOptions: prior state, tombstoned words         (modify)
  calendar.ts      utcDay, ISO dates, months                              (new)
  activity.ts      classifyEvents, dayCounts, summarizeDays               (new)  §7.4, §8.3
  xp.ts            computeXp with the daily cap                           (new)  §8.7, §10
  streaks.ts       isDayComplete, streakStatus, DayCompleteEvent          (new)  §8.4
  stamping.ts      openPushWindow, stampEvents                            (new)  §9.2, §10
  rebase.ts        isAboveMark, rebase                                    (new)  §4.3
  documents.ts     VersionedDocument, applyPatch, mergeUnlockSets         (new)  §9.2
  entitlement.ts   Entitlement, canUse, effectiveEntitlement, isStale     (new)  §8.8
  progress.ts      retentionRate, unitProgress, levelCompletion           (new)  §8.3, §7.2
  placement.ts     placementProgress, nextPlacementWords                  (new)  §7.2
  index.ts         re-exports the new modules                             (modify)
  *.test.ts        one test file beside each module
```

Dependency order: `calendar` → `activity` → `xp`, `streaks`, `progress`; `stamping` and `documents` and `entitlement` stand alone; `rebase` uses `replay`; `progress` uses `mastery` and `path`; `placement` uses `rng`.

---

### Task 1: Introduction day and later-day pass on review state

**Files:**
- Modify: `core/src/scheduler.ts` (the `ReviewState` interface and `applyGrade`)
- Modify: `core/src/session.ts` (the `SessionPlan.reviews` comment and the relearning test)
- Test: `core/src/scheduler.test.ts`, `core/src/session.test.ts`

**Interfaces:**
- Consumes: `ReviewState`, `applyGrade`, `localDay` (plan 1).
- Produces: `ReviewState.introducedDay: number` (local day of the first scheduled review) and `ReviewState.passedOnLaterDay: boolean` (a scheduled review on a day after `introducedDay` was graded anything but *Again*; sticky). Task 10 reads `passedOnLaterDay` for the unit-complete marker.

These are the roadmap's "first edits of plan 2". Neither changes a scheduling number: the pin test in `scheduler.test.ts` must keep passing with `SCHEDULER_VERSION` unchanged. The pin gains one step whose gap is not a multiple of 24 hours, so the local-day rule is pinned too.

- [ ] **Step 1: Write the failing tests**

In `core/src/scheduler.test.ts`, inside `describe('applyGrade', …)`, insert this test before `it('gives a first Easy more stability than Good…')`:

```ts
  it('records the introduction day and whether a later day was passed', () => {
    const first = applyGrade(null, word, Grade.Good, at(0, 21), TZ)
    expect(first.introducedDay).toBe(localDay(at(0, 21), TZ))
    expect(first.passedOnLaterDay).toBe(false)
    const sameDay = applyGrade(first, word, Grade.Good, at(0, 23), TZ)
    expect(sameDay.passedOnLaterDay).toBe(false)
    const nextDayAgain = applyGrade(sameDay, word, Grade.Again, at(1, 8), TZ)
    expect(nextDayAgain.passedOnLaterDay).toBe(false)
    const nextDayGood = applyGrade(nextDayAgain, word, Grade.Hard, at(1, 8), TZ)
    expect(nextDayGood.passedOnLaterDay).toBe(true)
    expect(nextDayGood.introducedDay).toBe(first.introducedDay)
    // Sticky: a later lapse does not take it away.
    expect(applyGrade(nextDayGood, word, Grade.Again, at(9, 8), TZ).passedOnLaterDay).toBe(true)
  })
```

In the same file, in the `SCHEDULER_VERSION` pin test, replace

```ts
    expect(s6.reps).toBe(6)
    expect(s6.lapses).toBe(1)
```

with

```ts
    const s7 = applyGrade(s6, word, Grade.Good, at(10, 21), TZ) // same day, evening
    expect(s7.stability).toBeCloseTo(2.16541104, 6)
    expect(s7.difficulty).toBeCloseTo(9.08641734, 6)

    const s8 = applyGrade(s7, word, Grade.Good, at(11, 8), TZ) // next morning, 11 h later: one local day
    expect(s8.stability).toBeCloseTo(3.24450688, 6)
    expect(s8.difficulty).toBeCloseTo(9.07255929, 6)

    expect(s8.reps).toBe(8)
    expect(s8.lapses).toBe(1)
```

In `core/src/session.test.ts`, change the scheduler import to

```ts
import { applyGrade, localDay, RELEARN_DELAY_MS, RETENTION_TARGETS, type ReviewState } from './scheduler'
```

and append at the end of the file:

```ts
describe('composeSession: relearning across devices', () => {
  it('treats a word last reviewed on a later local day as relearning, not as backlog', () => {
    // Rated Again at 12:30 Sofia time on a device set to UTC+14, where it is already 00:30 tomorrow.
    const ahead = applyGrade(null, w(1), Grade.Again, at(TODAY_INDEX, 12, 30), 14 * 60)
    expect(ahead.lastReviewDay).toBe(TODAY + 1)
    const now = at(TODAY_INDEX, 12, 30) + RELEARN_DELAY_MS
    const plan = composeSession(input({ states: new Map([[w(1), ahead]]), now }))
    expect(plan.reviews).toEqual([w(1)])
    expect(plan.backlogTotal).toBe(0)
    expect(plan.newWordsPaused).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `scheduler.test.ts` reports `expected undefined to be <number>` for `introducedDay`; `session.test.ts` reports `expected [] to deeply equal [ 'c:en-000001' ]` (the word lands in the backlog, not in the relearning group).

- [ ] **Step 3: Implement**

In `core/src/scheduler.ts`, the `ReviewState` interface becomes:

```ts
/** FSRS memory state for one word. Derived from events, never edited. */
export interface ReviewState {
  readonly wordId: WordId
  readonly stability: number
  readonly difficulty: number
  readonly introducedTs: number
  /** Local calendar day of the first scheduled review. */
  readonly introducedDay: number
  readonly lastReviewTs: number
  /** Local calendar day of the last review: what scheduling counts in. */
  readonly lastReviewDay: number
  readonly lastGrade: Grade
  readonly reps: number
  /**
   * Times the word left a passed state: an Again on a word whose last grade was
   * not Again. Consecutive Agains while relearning are one lapse, not several.
   */
  readonly lapses: number
  /**
   * Whether a scheduled review on a day after `introducedDay` was passed
   * (any grade but Again). Read by the unit-complete marker (spec §7.2).
   */
  readonly passedOnLaterDay: boolean
}
```

and the object `applyGrade` returns becomes:

```ts
  return {
    wordId,
    stability: next.stability,
    difficulty: next.difficulty,
    introducedTs: prev ? prev.introducedTs : ts,
    introducedDay: prev ? prev.introducedDay : day,
    lastReviewTs: ts,
    lastReviewDay: day,
    lastGrade: grade,
    reps: (prev?.reps ?? 0) + 1,
    lapses: (prev?.lapses ?? 0) + (lapsed ? 1 : 0),
    passedOnLaterDay:
      prev !== null && (prev.passedOnLaterDay || (grade !== Grade.Again && day > prev.introducedDay)),
  }
```

In `core/src/session.ts`, replace the `reviews` field's comment in `SessionPlan`:

```ts
  /**
   * Due words to review now: today's scheduled reviews, weakest first, within
   * today's cap, followed by words rated Again earlier today that are back.
   */
  readonly reviews: readonly WordId[]
```

and in `composeSession` replace

```ts
    if (state.lastReviewDay === input.today) relearning.push(due)
```

with

```ts
    // `>=`: a device whose clock runs behind another's may see a review from a later local day.
    if (state.lastReviewDay >= input.today) relearning.push(due)
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 105 tests pass (18 in `scheduler.test.ts`, 19 in `session.test.ts`); `tsc` prints nothing. `SCHEDULER_VERSION` is still `fsrs6-tsfsrs5.4.2-r2`.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): introduction day and later-day pass on review state"
```

---

### Task 2: Calendar helpers

**Files:**
- Create: `core/src/calendar.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/calendar.test.ts`

**Interfaces:**
- Consumes: `DAY_MS`, `localDay` (plan 1).
- Produces: `utcDay(ts: number): number`; `dayToIsoDate(day: number): string` (`YYYY-MM-DD`); `isoDateToDay(iso: string): number` (throws on a malformed or impossible date); `monthOf(day: number): number` (months since year 0, for grouping only).

- [ ] **Step 1: Write the failing test**

`core/src/calendar.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { dayToIsoDate, isoDateToDay, monthOf, utcDay } from './calendar'
import { DAY_MS, localDay } from './scheduler'

describe('calendar', () => {
  it('turns a day number into the ISO date day_complete stores, and back', () => {
    const day = localDay(Date.UTC(2026, 0, 5, 23, 30), 120) // 6 January in Sofia
    expect(dayToIsoDate(day)).toBe('2026-01-06')
    expect(isoDateToDay('2026-01-06')).toBe(day)
    expect(isoDateToDay('1970-01-01')).toBe(0)
  })

  it('rejects malformed and impossible dates', () => {
    expect(() => isoDateToDay('2026-1-6')).toThrow()
    expect(() => isoDateToDay('2026-02-30')).toThrow()
    expect(() => isoDateToDay('06/01/2026')).toThrow()
  })

  it('counts UTC days for the XP cap, whatever the learner’s offset', () => {
    const ts = Date.UTC(2026, 0, 5, 23, 30)
    expect(utcDay(ts)).toBe(localDay(ts, 0))
    expect(utcDay(ts)).toBe(Math.floor(ts / DAY_MS))
    expect(utcDay(ts + 30 * 60_000)).toBe(utcDay(ts) + 1)
  })

  it('groups days by calendar month', () => {
    expect(monthOf(isoDateToDay('2026-01-31'))).toBe(monthOf(isoDateToDay('2026-01-01')))
    expect(monthOf(isoDateToDay('2026-02-01'))).toBe(monthOf(isoDateToDay('2026-01-31')) + 1)
    expect(monthOf(isoDateToDay('2027-01-01'))).toBe(monthOf(isoDateToDay('2026-01-01')) + 12)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './calendar'`.

- [ ] **Step 3: Implement**

`core/src/calendar.ts`:

```ts
import { DAY_MS } from './scheduler'

/** The server's day for the XP cap (spec §8.7): UTC, so no client setting can move it. */
export function utcDay(ts: number): number {
  return Math.floor(ts / DAY_MS)
}

/** `YYYY-MM-DD` for a day number, the form `day_complete.local_date` is stored in (spec §6.2). */
export function dayToIsoDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

export function isoDateToDay(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) throw new Error(`Invalid date: ${JSON.stringify(iso)}`)
  const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS
  if (dayToIsoDate(day) !== iso) throw new Error(`Invalid date: ${JSON.stringify(iso)}`)
  return day
}

/** The calendar month a day falls in, as months since year 0. For grouping only. */
export function monthOf(day: number): number {
  const date = new Date(day * DAY_MS)
  return date.getUTCFullYear() * 12 + date.getUTCMonth()
}
```

Append to `core/src/index.ts`:

```ts
export * from './calendar'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 109 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): calendar helpers for days, dates and months"
```

---

### Task 3: Classifying answers

**Files:**
- Create: `core/src/activity.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/activity.test.ts`

**Interfaces:**
- Consumes: `ReplayEvent`, `compareEvents`, `resolveAlias`, `AliasMap`, `replay` (plan 1); `localDay`, `ReviewState` (plan 1).
- Produces: `EventKind = 'new' | 'review' | 'repeat' | 'practice'`; `ClassifiedEvent<E>` `{ event, kind, wordId, day }`; `ActivityOptions` `{ aliases?, prior? }`; `classifyEvents<E extends ReplayEvent>(events, options?): ClassifiedEvent<E>[]`; `DayCounts` `{ reviewsDone, newWordsDone, practiceDone, answered }` and `dayCounts(classified, day)`; `DaySummary` `{ day, reviews, successes, newWords }`, `summarizeDays(classified): Map<number, DaySummary>`, `mergeSummaries(...sources): Map<number, DaySummary>`.

This is the one shared helper the roadmap asks for: `dayCounts(...).reviewsDone` is `SessionInput.reviewsDoneToday` and `newWordsDone` is `newWordsDoneToday`. The server classifies its whole log with no `prior`; a client passes the review state it pulled as `prior` and the events it has recorded since.

- [ ] **Step 1: Write the failing test**

`core/src/activity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifyEvents, dayCounts, mergeSummaries, summarizeDays, type DaySummary } from './activity'
import { replay, type ReplayEvent } from './replay'
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
  it('tells a word’s first review, its first of a later day, and same-day repeats apart', () => {
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

  it('groups a merged user word’s events under the entry', () => {
    const a = ev(mine, Grade.Good, at(0, 10))
    const b = ev(bank, Grade.Good, at(1, 10))
    const classified = classifyEvents([a, b], { aliases: new Map<WordId, WordId>([[mine, bank]]) })
    expect(classified.map((c) => c.wordId)).toEqual([bank, bank])
    expect(classified.map((c) => c.kind)).toEqual(['new', 'review'])
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
  it('summarises reviews, first-attempt successes and new words per local day', () => {
    const events = [
      ev(bank, Grade.Good, at(0, 10)),
      ev(river, Grade.Good, at(0, 10)),
      ev(bank, Grade.Again, at(2, 9)),
      ev(bank, Grade.Good, at(2, 9, 30)), // same-day relearn: not a first attempt
      ev(river, Grade.Hard, at(2, 9)),
      ev(river, Grade.Good, at(2, 11), { practice: true }),
    ]
    const summary = summarizeDays(classifyEvents(events))
    expect(summary.get(day(0))).toEqual({ day: day(0), reviews: 0, successes: 0, newWords: 2 })
    expect(summary.get(day(2))).toEqual({ day: day(2), reviews: 2, successes: 1, newWords: 0 })
    expect(summary.has(day(1))).toBe(false)
  })

  it('adds the pulled summary and the days recorded since', () => {
    const pulled: DaySummary[] = [{ day: day(0), reviews: 5, successes: 4, newWords: 1 }]
    const local: DaySummary[] = [
      { day: day(0), reviews: 1, successes: 1, newWords: 0 },
      { day: day(1), reviews: 2, successes: 0, newWords: 3 },
    ]
    const merged = mergeSummaries(pulled, local)
    expect(merged.get(day(0))).toEqual({ day: day(0), reviews: 6, successes: 5, newWords: 1 })
    expect(merged.get(day(1))).toEqual(local[1])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './activity'`.

- [ ] **Step 3: Implement**

`core/src/activity.ts`:

```ts
import { compareEvents, resolveAlias, type AliasMap, type ReplayEvent } from './replay'
import { localDay, type ReviewState } from './scheduler'
import { Grade } from './types'
import type { WordId } from './wordId'

/**
 * What one answer was, for XP, the daily counts and the progress metrics:
 * `new` — a word's first scheduled review ever; `review` — its first scheduled
 * review of a local day; `repeat` — a later scheduled answer the same day
 * (relearning); `practice` — a practice or matching answer (spec §7.4, §8.7).
 */
export type EventKind = 'new' | 'review' | 'repeat' | 'practice'

export interface ClassifiedEvent<E extends ReplayEvent = ReplayEvent> {
  readonly event: E
  readonly kind: EventKind
  /** The word after alias resolution. */
  readonly wordId: WordId
  /** The learner's local day of the answer. */
  readonly day: number
}

export interface ActivityOptions {
  readonly aliases?: AliasMap
  /**
   * Review state derived from everything before `events`. The server passes
   * nothing and classifies the whole log; a client passes the state it pulled
   * and classifies the events it has recorded since (spec §4.3).
   */
  readonly prior?: ReadonlyMap<WordId, ReviewState>
}

function isScheduled(event: ReplayEvent): boolean {
  return !event.practice && event.mode !== 'matching'
}

/**
 * Classifies events in replay order, deduplicated on reviewId, so that every
 * count derived from the log is a function of the set of events.
 */
export function classifyEvents<E extends ReplayEvent>(
  events: Iterable<E>,
  options: ActivityOptions = {},
): ClassifiedEvent<E>[] {
  const aliases = options.aliases ?? new Map()
  const ordered = [...events].sort(compareEvents)
  const unique = new Map<string, E>()
  for (const event of ordered) {
    if (!unique.has(event.reviewId)) unique.set(event.reviewId, event)
  }
  const lastDay = new Map<WordId, number>()
  for (const [wordId, state] of options.prior ?? []) lastDay.set(wordId, state.lastReviewDay)

  const out: ClassifiedEvent<E>[] = []
  for (const event of unique.values()) {
    const wordId = resolveAlias(event.wordId, aliases)
    const day = localDay(event.effectiveTs, event.clientTzOffsetMin)
    let kind: EventKind = 'practice'
    if (isScheduled(event)) {
      const last = lastDay.get(wordId)
      kind = last === undefined ? 'new' : last === day ? 'repeat' : 'review'
      lastDay.set(wordId, day)
    }
    out.push({ event, kind, wordId, day })
  }
  return out
}

/** The counts session composition and the day-complete rule read (spec §7.4, §8.4). */
export interface DayCounts {
  /** Distinct words, introduced before the day, whose first scheduled review of the day is answered. */
  readonly reviewsDone: number
  readonly newWordsDone: number
  readonly practiceDone: number
  /** Every answer given that day, of any kind. */
  readonly answered: number
}

export function dayCounts(classified: Iterable<ClassifiedEvent>, day: number): DayCounts {
  let reviewsDone = 0
  let newWordsDone = 0
  let practiceDone = 0
  let answered = 0
  for (const item of classified) {
    if (item.day !== day) continue
    answered += 1
    if (item.kind === 'review') reviewsDone += 1
    else if (item.kind === 'new') newWordsDone += 1
    else if (item.kind === 'practice') practiceDone += 1
  }
  return { reviewsDone, newWordsDone, practiceDone, answered }
}

/** One local day of the compact summary a pull carries (spec §8.3). */
export interface DaySummary {
  readonly day: number
  /** First scheduled reviews of the day of words introduced earlier. */
  readonly reviews: number
  /** Those answered with any grade but Again. */
  readonly successes: number
  readonly newWords: number
}

export function summarizeDays(classified: Iterable<ClassifiedEvent>): Map<number, DaySummary> {
  const out = new Map<number, DaySummary>()
  for (const item of classified) {
    if (item.kind !== 'review' && item.kind !== 'new') continue
    const prev = out.get(item.day) ?? { day: item.day, reviews: 0, successes: 0, newWords: 0 }
    const review = item.kind === 'review'
    out.set(item.day, {
      day: item.day,
      reviews: prev.reviews + (review ? 1 : 0),
      successes: prev.successes + (review && item.event.grade !== Grade.Again ? 1 : 0),
      newWords: prev.newWords + (review ? 0 : 1),
    })
  }
  return out
}

/** Adds summaries day by day: the pulled summary plus the days recorded since. */
export function mergeSummaries(...sources: Iterable<DaySummary>[]): Map<number, DaySummary> {
  const out = new Map<number, DaySummary>()
  for (const source of sources) {
    for (const s of source) {
      const prev = out.get(s.day)
      out.set(
        s.day,
        prev
          ? {
              day: s.day,
              reviews: prev.reviews + s.reviews,
              successes: prev.successes + s.successes,
              newWords: prev.newWords + s.newWords,
            }
          : s,
      )
    }
  }
  return out
}
```

Append to `core/src/index.ts`:

```ts
export * from './activity'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 118 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): classify answers as new, review, repeat or practice"
```

---

### Task 4: XP

**Files:**
- Create: `core/src/xp.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/xp.test.ts`

**Interfaces:**
- Consumes: `classifyEvents`, `ActivityOptions`, `EventKind` (Task 3); `utcDay` (Task 2); `ReplayEvent`, `StampedReviewEvent`.
- Produces: `XP_AMOUNTS: Record<EventKind, number>`; `DAILY_XP_CAP`; `XpEvent = ReplayEvent & Partial<Pick<StampedReviewEvent, 'xpEligible'>>`; `XpResult` `{ awards: ReadonlyMap<reviewId, number>, byUtcDay: ReadonlyMap<number, number>, total }`; `computeXp(events, options?): XpResult`.

- [ ] **Step 1: Write the failing test**

`core/src/xp.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './xp'`.

- [ ] **Step 3: Implement**

`core/src/xp.ts`:

```ts
import { classifyEvents, type ActivityOptions, type EventKind } from './activity'
import { utcDay } from './calendar'
import type { ReplayEvent } from './replay'
import type { StampedReviewEvent } from './types'

/** XP per answer, by what the answer was (spec §8.7). Tuning values (§15). */
export const XP_AMOUNTS: Readonly<Record<EventKind, number>> = {
  new: 10,
  review: 10,
  repeat: 0,
  practice: 2,
}

/** Per UTC day (spec §8.7). Bounds grinding and cheating alike. */
export const DAILY_XP_CAP = 1000

/**
 * A stamped event carries the server's verdict; an event still in a client's
 * outbox has none and is treated as eligible for offline display.
 */
export type XpEvent = ReplayEvent & Partial<Pick<StampedReviewEvent, 'xpEligible'>>

export interface XpResult {
  /** What each event earned after the cap, by reviewId. */
  readonly awards: ReadonlyMap<string, number>
  readonly byUtcDay: ReadonlyMap<number, number>
  readonly total: number
}

/**
 * Recomputes XP from events, never increments it (spec §8.5, §10). Within a
 * UTC day the cap is spent in replay order, so which events are credited is
 * a function of the set of events, not of their arrival.
 */
export function computeXp(events: Iterable<XpEvent>, options: ActivityOptions = {}): XpResult {
  const awards = new Map<string, number>()
  const byUtcDay = new Map<number, number>()
  let total = 0
  for (const { event, kind } of classifyEvents(events, options)) {
    const day = utcDay(event.effectiveTs)
    const spent = byUtcDay.get(day) ?? 0
    const amount = event.xpEligible === false ? 0 : Math.min(XP_AMOUNTS[kind], Math.max(0, DAILY_XP_CAP - spent))
    awards.set(event.reviewId, amount)
    byUtcDay.set(day, spent + amount)
    total += amount
  }
  return { awards, byUtcDay, total }
}
```

Append to `core/src/index.ts`:

```ts
export * from './xp'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 125 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): XP with the daily cap, recomputed from events"
```

---

### Task 5: Streaks and the completed day

**Files:**
- Create: `core/src/streaks.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/streaks.test.ts`

**Interfaces:**
- Consumes: `monthOf`, `isoDateToDay` (Task 2).
- Produces: `STREAK_FREEZES_PER_MONTH`; `DAY_COMPLETE_RULE_VERSION`; `DayCompleteEvent` `{ localDate: number, ruleVersion }`; `DayCompleteInput` `{ backlogTotal, reviewCap, reviewsDoneToday, answeredToday, dailyGoal: number | null }` and `isDayComplete(input): boolean`; `StreakStatus` `{ length, todayComplete, freezesLeft }` and `streakStatus(completeDays: Iterable<number>, today): StreakStatus`.

The client calls `isDayComplete` after every answer with `composeSession(...).backlogTotal` and today's `dayCounts`, and emits one `DayCompleteEvent` the first time it is true (plan 4). `localDate` is a day number in `core`; `client-data` and the server store it as `dayToIsoDate(localDate)`.

- [ ] **Step 1: Write the failing test**

`core/src/streaks.test.ts`:

```ts
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isoDateToDay } from './calendar'
import { isDayComplete, STREAK_FREEZES_PER_MONTH, streakStatus, type DayCompleteInput } from './streaks'

const d = (iso: string) => isoDateToDay(iso)
const range = (from: string, to: string) => {
  const out: number[] = []
  for (let day = d(from); day <= d(to); day += 1) out.push(day)
  return out
}

describe('isDayComplete', () => {
  const base: DayCompleteInput = { backlogTotal: 0, reviewCap: 100, reviewsDoneToday: 0, answeredToday: 0, dailyGoal: null }

  it('needs at least one answer, even when nothing is due', () => {
    expect(isDayComplete(base)).toBe(false)
    expect(isDayComplete({ ...base, answeredToday: 1 })).toBe(true)
  })

  it('counts the day when the capped due figure is finished', () => {
    expect(isDayComplete({ ...base, backlogTotal: 3, answeredToday: 5 })).toBe(false)
    expect(isDayComplete({ ...base, backlogTotal: 250, reviewsDoneToday: 100, answeredToday: 100 })).toBe(true)
    expect(isDayComplete({ ...base, backlogTotal: 250, reviewsDoneToday: 99, answeredToday: 99 })).toBe(false)
  })

  it('counts the day when the daily goal is met, whatever is still due', () => {
    expect(isDayComplete({ ...base, backlogTotal: 40, answeredToday: 20, dailyGoal: 20 })).toBe(true)
    expect(isDayComplete({ ...base, backlogTotal: 40, answeredToday: 19, dailyGoal: 20 })).toBe(false)
  })
})

describe('streakStatus', () => {
  it('is zero with no completed day', () => {
    expect(streakStatus([], d('2026-03-10'))).toEqual({ length: 0, todayComplete: false, freezesLeft: 2 })
  })

  it('counts consecutive completed days up to today', () => {
    const days = range('2026-03-01', '2026-03-10')
    expect(streakStatus(days, d('2026-03-10')).length).toBe(10)
    expect(streakStatus(days, d('2026-03-10')).todayComplete).toBe(true)
  })

  it('does not break until the day is over', () => {
    const days = range('2026-03-01', '2026-03-09')
    expect(streakStatus(days, d('2026-03-10'))).toMatchObject({ length: 9, todayComplete: false })
  })

  it('spends a freeze on a missed day, silently, and counts the frozen day', () => {
    const days = [...range('2026-03-01', '2026-03-04'), ...range('2026-03-06', '2026-03-08')]
    expect(streakStatus(days, d('2026-03-08'))).toEqual({ length: 8, todayComplete: true, freezesLeft: 1 })
  })

  it('breaks on the third missed day of a month', () => {
    const days = [d('2026-03-01'), d('2026-03-05'), d('2026-03-06')]
    expect(streakStatus(days, d('2026-03-06'))).toMatchObject({ length: 2, freezesLeft: 0 })
    const twoMisses = [d('2026-03-01'), d('2026-03-04'), d('2026-03-05')]
    expect(streakStatus(twoMisses, d('2026-03-05'))).toMatchObject({ length: 5, freezesLeft: 0 })
  })

  it('gives each calendar month its own freezes', () => {
    // Four misses in a row across the month boundary: two in January, two in February.
    const across = [...range('2026-01-28', '2026-01-29'), d('2026-02-03')]
    expect(streakStatus(across, d('2026-02-03'))).toEqual({ length: 7, todayComplete: true, freezesLeft: 0 })
    // Three misses, all in February.
    const inFeb = [...range('2026-01-29', '2026-01-31'), d('2026-02-04')]
    expect(streakStatus(inFeb, d('2026-02-04'))).toMatchObject({ length: 1, freezesLeft: 0 })
  })

  it('starts on a completed day: leading misses never count', () => {
    expect(streakStatus([d('2026-03-05')], d('2026-03-06')).length).toBe(1)
    expect(streakStatus([d('2026-03-05')], d('2026-03-09')).length).toBe(0)
  })

  it('is unchanged by anything but the set of dates', () => {
    const days = range('2026-03-01', '2026-03-10')
    expect(streakStatus(days, d('2026-03-10'))).toEqual(streakStatus([...days].reverse(), d('2026-03-10')))
    expect(streakStatus([...days, ...days], d('2026-03-10'))).toEqual(streakStatus(days, d('2026-03-10')))
  })

  it('never gets shorter when a late-syncing device adds a date', () => {
    const today = d('2026-06-30')
    const arbDays = fc.uniqueArray(fc.integer({ min: today - 120, max: today }), { maxLength: 60 })
    fc.assert(
      fc.property(arbDays, fc.integer({ min: today - 120, max: today }), (days, added) => {
        const before = streakStatus(days, today).length
        const after = streakStatus([...days, added], today).length
        expect(after).toBeGreaterThanOrEqual(before)
      }),
    )
  })

  it('exposes the freezes per month as a constant the UI can show', () => {
    expect(STREAK_FREEZES_PER_MONTH).toBe(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './streaks'`.

- [ ] **Step 3: Implement**

`core/src/streaks.ts`:

```ts
import { monthOf } from './calendar'

/** Streak freezes a learner gets each calendar month (spec §8.4). */
export const STREAK_FREEZES_PER_MONTH = 2

/** Bumped when the day-complete condition changes; stored on every day_complete event. */
export const DAY_COMPLETE_RULE_VERSION = 'r1'

/** The immutable event a client emits once, when the condition is first met (spec §8.4). */
export interface DayCompleteEvent {
  /** The learner's local day number of the answer that completed the day. */
  readonly localDate: number
  readonly ruleVersion: string
}

export interface DayCompleteInput {
  /** `SessionPlan.backlogTotal` after the latest answer: scheduled reviews still due today. */
  readonly backlogTotal: number
  readonly reviewCap: number
  /** `DayCounts.reviewsDone` for today. */
  readonly reviewsDoneToday: number
  /** `DayCounts.answered` for today. */
  readonly answeredToday: number
  /** The learner's optional daily goal, in answers. */
  readonly dailyGoal: number | null
}

/**
 * Whether today counts: the capped due figure is finished, or the daily goal
 * is met, and at least one item was answered either way. With nothing due, a
 * single new word or practice answer completes the day (spec §8.4).
 */
export function isDayComplete(input: DayCompleteInput): boolean {
  if (input.answeredToday < 1) return false
  const capLeft = Math.max(0, input.reviewCap - input.reviewsDoneToday)
  const dueLeft = Math.min(input.backlogTotal, capLeft)
  if (dueLeft === 0) return true
  return input.dailyGoal !== null && input.answeredToday >= input.dailyGoal
}

export interface StreakStatus {
  /** Days in the current run, complete and frozen alike. */
  readonly length: number
  readonly todayComplete: boolean
  /** Freezes still available in today's calendar month. */
  readonly freezesLeft: number
}

/**
 * A pure function of the set of completed days (spec §8.4). The run ends
 * today if today is complete, else yesterday (a day is not missed until it is
 * over), and extends back while every calendar month in it has at most
 * STREAK_FREEZES_PER_MONTH missed days. Adding a date can only lengthen it.
 */
export function streakStatus(completeDays: Iterable<number>, today: number): StreakStatus {
  const days = new Set(completeDays)
  const todayComplete = days.has(today)
  const missesByMonth = new Map<number, number>()
  const missesIn = (month: number) => missesByMonth.get(month) ?? 0
  let length = 0
  if (days.size > 0) {
    const earliest = Math.min(...days)
    const end = todayComplete ? today : today - 1
    for (let day = end; day >= earliest; day -= 1) {
      if (days.has(day)) {
        length = end - day + 1
        continue
      }
      const month = monthOf(day)
      const misses = missesIn(month) + 1
      if (misses > STREAK_FREEZES_PER_MONTH) break
      missesByMonth.set(month, misses)
    }
  }
  return { length, todayComplete, freezesLeft: STREAK_FREEZES_PER_MONTH - missesIn(monthOf(today)) }
}
```

Append to `core/src/index.ts`:

```ts
export * from './streaks'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 138 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): streaks from day_complete dates with monthly freezes"
```

---

### Task 6: Event stamping

**Files:**
- Create: `core/src/stamping.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/stamping.test.ts`

**Interfaces:**
- Consumes: `ReviewEvent`, `StampedReviewEvent`, `Mode` (plan 1); `computeXp` (Task 4, in the test only).
- Produces: `CLOCK_TOLERANCE_MS`; `PLAUSIBILITY_FLOOR_MS: Record<Mode, number>`; `DENSITY_WINDOW_MS`, `DENSITY_MAX_EVENTS`; `DeviceMark` `{ deviceSeq, effectiveTs }`; `PushWindowInput` `{ clientNow, serverNow, lastAccepted: DeviceMark | null, accountCreatedAt }`; `PushWindow` `{ clockOffsetMs, lowerBound, upperBound }`; `openPushWindow(input): PushWindow`; `stampEvents(events: readonly ReviewEvent[], window, receivedAt): StampedReviewEvent[]` (returned in `(deviceId, deviceSeq)` order).

The server (plan 5) calls `openPushWindow` once per `push_id`, when the first page arrives, stores the window with the push, and calls `stampEvents` for every page against it. Events whose `deviceSeq` is at or below the device's mark are duplicates the server drops on `review_id` before stamping.

- [ ] **Step 1: Write the failing test**

`core/src/stamping.test.ts`:

```ts
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

  it('bounds a known device by its last accepted event and a new one by the account’s creation less a day', () => {
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

  it('makes a device’s timestamps non-decreasing without marking the moved event', () => {
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './stamping'`.

- [ ] **Step 3: Implement**

`core/src/stamping.ts`:

```ts
import type { Mode, ReviewEvent, StampedReviewEvent } from './types'

/** Client and server clocks further apart than this are treated as a clock offset (spec §9.2). Tuning (§15). */
export const CLOCK_TOLERANCE_MS = 2 * 60_000

/** An answer faster than this is not a person answering (spec §10). Tuning (§15). */
export const PLAUSIBILITY_FLOOR_MS: Readonly<Record<Mode, number>> = {
  flashcard: 300,
  multiple_choice: 400,
  listening_select: 600,
  matching: 250,
}

/** More answers than this from one device in one window of effective time is not a person (spec §10). */
export const DENSITY_WINDOW_MS = 60_000
export const DENSITY_MAX_EVENTS = 60

/** The `device` row (spec §6.2): the last event the server accepted from it. */
export interface DeviceMark {
  readonly deviceSeq: number
  readonly effectiveTs: number
}

export interface PushWindowInput {
  /** The client's clock at the moment of sending. */
  readonly clientNow: number
  readonly serverNow: number
  /** Null for a device the server has never seen. */
  readonly lastAccepted: DeviceMark | null
  readonly accountCreatedAt: number
}

/** Fixed when the first page of a push arrives; every page of the push uses it (spec §9.2). */
export interface PushWindow {
  /** Added to every clientTs in the push. Zero within the tolerance. */
  readonly clockOffsetMs: number
  readonly lowerBound: number
  readonly upperBound: number
}

export function openPushWindow(input: PushWindowInput): PushWindow {
  const skew = input.serverNow - input.clientNow
  const clockOffsetMs = Math.abs(skew) > CLOCK_TOLERANCE_MS ? skew : 0
  // A never-seen device's bound is the account's creation less a day, which covers a demo (spec §8.6).
  const lowerBound = input.lastAccepted ? input.lastAccepted.effectiveTs : input.accountCreatedAt - 86_400_000
  return { clockOffsetMs, lowerBound, upperBound: input.serverNow }
}

function byDevice(a: ReviewEvent, b: ReviewEvent): number {
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1
  return a.deviceSeq - b.deviceSeq
}

/**
 * Assigns effective time and the XP verdict to one page of a push (spec §9.2
 * steps 2–4, §10). Returns the events ordered by (deviceId, deviceSeq). Pure:
 * stamping the same page against the same window gives the same stamps.
 */
export function stampEvents(
  events: readonly ReviewEvent[],
  window: PushWindow,
  receivedAt: number,
): StampedReviewEvent[] {
  const ordered = [...events].sort(byDevice)
  const out: StampedReviewEvent[] = []
  let prevDevice: string | null = null
  let prevTs = Number.NEGATIVE_INFINITY
  for (const event of ordered) {
    if (event.deviceId !== prevDevice) {
      prevDevice = event.deviceId
      prevTs = Number.NEGATIVE_INFINITY
    }
    const corrected = event.clientTs + window.clockOffsetMs
    const clamped = Math.min(Math.max(corrected, window.lowerBound), window.upperBound)
    const wasClamped = clamped !== corrected
    // Restore device_seq order: never earlier than the device's previous event.
    const effectiveTs = Math.max(clamped, prevTs)
    prevTs = effectiveTs
    const plausible = event.latencyMs >= PLAUSIBILITY_FLOOR_MS[event.mode]
    out.push({ ...event, receivedAt, effectiveTs, xpEligible: !wasClamped && plausible })
  }
  return markDense(out)
}

/** Marks events XP-ineligible where one device's answers exceed the density ceiling. */
function markDense(events: StampedReviewEvent[]): StampedReviewEvent[] {
  return events.map((event, i) => {
    let count = 0
    for (let j = i; j >= 0; j -= 1) {
      const other = events[j]!
      if (other.deviceId !== event.deviceId || other.effectiveTs <= event.effectiveTs - DENSITY_WINDOW_MS) break
      count += 1
    }
    return count > DENSITY_MAX_EVENTS ? { ...event, xpEligible: false } : event
  })
}
```

Append to `core/src/index.ts`:

```ts
export * from './stamping'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 151 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): event stamping with clock correction and the XP verdict"
```

---

### Task 7: Replay onto prior state, tombstones, and the rebase rule

**Files:**
- Modify: `core/src/replay.ts` (the `replay` signature and body)
- Create: `core/src/rebase.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/replay.test.ts`, `core/src/rebase.test.ts`

**Interfaces:**
- Consumes: `replay`, `ReplayEvent`, `AliasMap`, `ReviewState`.
- Produces: `ReplayOptions` `{ prior?: ReadonlyMap<WordId, ReviewState>, tombstoned?: ReadonlySet<WordId> }` as `replay`'s third parameter; `DeviceMarks = ReadonlyMap<deviceId, deviceSeq>`; `isAboveMark(event, marks): boolean`; `rebase(serverStates, marks, localEvents, aliases?, tombstoned?): Map<WordId, ReviewState>`.

- [ ] **Step 1: Write the failing tests**

Append to `core/src/replay.test.ts`:

```ts
describe('replay: from a prior state and with tombstones', () => {
  it('folds events onto a prior state instead of starting from nothing', () => {
    const a = ev(bank, Grade.Good, T0)
    const b = ev(bank, Grade.Hard, T0 + 3 * DAY_MS)
    const prior = replay([a])
    expect(replay([b], new Map(), { prior })).toEqual(replay([a, b]))
    expect(prior.get(bank)?.reps).toBe(1)
  })

  it('keeps prior state the events do not touch', () => {
    const prior = replay([ev(river, Grade.Good, T0)])
    const states = replay([ev(bank, Grade.Good, T0 + DAY_MS)], new Map(), { prior })
    expect(states.get(river)).toEqual(prior.get(river))
    expect(states.has(bank)).toBe(true)
  })

  it('derives no state for a tombstoned user word, whose events stay in the log', () => {
    const events = [ev(mine, Grade.Good, T0), ev(bank, Grade.Good, T0)]
    const states = replay(events, new Map(), { tombstoned: new Set([mine]) })
    expect(states.has(mine)).toBe(false)
    expect(states.has(bank)).toBe(true)
    // Undeleting is only the absence of the tombstone: the events were never rewritten.
    expect(replay(events).has(mine)).toBe(true)
  })

  it('keeps the entry’s state when a user word merged into it is tombstoned', () => {
    const events = [ev(mine, Grade.Good, T0), ev(bank, Grade.Good, T0 + DAY_MS)]
    const aliases = new Map<WordId, WordId>([[mine, bank]])
    const states = replay(events, aliases, { tombstoned: new Set([mine]) })
    expect(states.get(bank)?.reps).toBe(2)
    expect(states.has(mine)).toBe(false)
  })
})
```

`core/src/rebase.test.ts`:

```ts
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
  it('is above when newer than the device’s mark or from a device the server has not seen', () => {
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

  it('takes the server’s word for everything at or below the mark', () => {
    // The server saw a second device's review that this device never had.
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `rebase.test.ts`: `Cannot find module './rebase'`; `replay.test.ts`: the prior-state tests report `expected 2 to be 1` or similar (the third argument is ignored), and the tombstone tests `expected true to be false`.

- [ ] **Step 3: Implement**

In `core/src/replay.ts`, replace the `replay` function with:

```ts
export interface ReplayOptions {
  /**
   * State derived from every event before `events`, to fold them onto: the
   * server's snapshot when a client re-applies its newer events (spec §4.3).
   */
  readonly prior?: ReadonlyMap<WordId, ReviewState>
  /** Tombstoned user words: their events stay in the log but derive no state (spec §9.2). */
  readonly tombstoned?: ReadonlySet<WordId>
}

/**
 * Derives review state from the event log. The result depends only on the
 * set of events: not on their order, and not on duplicates. Practice and
 * matching events are skipped (spec §7.4, §8.1).
 */
export function replay(
  events: Iterable<ReplayEvent>,
  aliases: AliasMap = new Map(),
  options: ReplayOptions = {},
): Map<WordId, ReviewState> {
  // Ordering before deduplication keeps the choice between two payloads that
  // collide on one reviewId a function of the events, not of their arrival.
  const ordered = [...events].filter(isScheduled).sort(compareEvents)
  const unique = new Map<string, ReplayEvent>()
  for (const event of ordered) {
    if (!unique.has(event.reviewId)) unique.set(event.reviewId, event)
  }
  const states = new Map<WordId, ReviewState>(options.prior)
  for (const event of unique.values()) {
    const wordId = resolveAlias(event.wordId, aliases)
    const prev = states.get(wordId) ?? null
    states.set(wordId, applyGrade(prev, wordId, event.grade, event.effectiveTs, event.clientTzOffsetMin))
  }
  // After alias resolution: a user word merged into an entry is tombstoned,
  // but its events now derive the entry's state, which stays.
  for (const wordId of options.tombstoned ?? []) states.delete(wordId)
  return states
}
```

`core/src/rebase.ts`:

```ts
import { replay, type AliasMap, type ReplayEvent } from './replay'
import type { ReviewState } from './scheduler'
import type { WordId } from './wordId'

/** Per device, the highest deviceSeq the server's derived state included (spec §4.3). */
export type DeviceMarks = ReadonlyMap<string, number>

/** An event the server's snapshot cannot contain: newer than its mark, or from a device it has not seen. */
export function isAboveMark(event: Pick<ReplayEvent, 'deviceId' | 'deviceSeq'>, marks: DeviceMarks): boolean {
  const mark = marks.get(event.deviceId)
  return mark === undefined || event.deviceSeq > mark
}

/**
 * The rebase rule: replace local state with the server's, then re-apply the
 * local events above the server's marks, so a pull never rolls back answers
 * the learner has just given (spec §4.3). Events still in the outbox carry
 * their clientTs as effectiveTs until the server stamps them.
 */
export function rebase(
  serverStates: ReadonlyMap<WordId, ReviewState>,
  marks: DeviceMarks,
  localEvents: Iterable<ReplayEvent>,
  aliases: AliasMap = new Map(),
  tombstoned: ReadonlySet<WordId> = new Set(),
): Map<WordId, ReviewState> {
  const newer = [...localEvents].filter((event) => isAboveMark(event, marks))
  return replay(newer, aliases, { prior: serverStates, tombstoned })
}
```

Append to `core/src/index.ts`:

```ts
export * from './rebase'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 160 tests pass (18 in `replay.test.ts`, 5 in `rebase.test.ts`); `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): replay onto prior state, tombstones and the rebase rule"
```

---

### Task 8: Versioned documents

**Files:**
- Create: `core/src/documents.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/documents.test.ts`

**Interfaces:**
- Consumes: nothing from other modules.
- Produces: `DocumentClass = 'versioned' | 'server_owned'`; `VersionedDocument<T>` `{ version, fields: T, fieldVersions: Partial<Record<keyof T, number>>, deleted }`; `DocumentPatch<T>` `{ baseVersion, fields: Partial<T>, deleted? }`; `PatchResult<T>` (`{ accepted: true, document, merged }` or `{ accepted: false, reason: 'server_owned' | 'base_ahead_of_server' | 'version_not_newer' }`); `createDocument(fields, version)`; `applyPatch(document, patch, nextVersion, documentClass?)`; `mergeUnlockSets(...sets): Set<string>`.

The server (plan 5) owns `nextVersion`: one monotonic counter per document. Plan 4's outbox sends patches; plan 5 applies them with this function and stores the result. The three-record merge of a user word into a corpus entry (spec §9.2) is a server transaction over the user-word document shape plan 3 defines, and is written there.

- [ ] **Step 1: Write the failing test**

`core/src/documents.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyPatch, createDocument, mergeUnlockSets, type VersionedDocument } from './documents'

interface Settings {
  readonly newWordLimit: number
  readonly retention: 'relaxed' | 'standard' | 'intensive'
  readonly note: string
}

const initial: VersionedDocument<Settings> = createDocument({ newWordLimit: 10, retention: 'standard', note: '' }, 1)

describe('createDocument', () => {
  it('stamps every field with the creating version', () => {
    expect(initial).toEqual({
      version: 1,
      fields: { newWordLimit: 10, retention: 'standard', note: '' },
      fieldVersions: { newWordLimit: 1, retention: 1, note: 1 },
      deleted: false,
    })
  })
})

describe('applyPatch', () => {
  it('accepts a write against the current version and bumps the changed fields', () => {
    const result = applyPatch(initial, { baseVersion: 1, fields: { newWordLimit: 15 } }, 2)
    expect(result).toEqual({
      accepted: true,
      merged: false,
      document: {
        version: 2,
        fields: { newWordLimit: 15, retention: 'standard', note: '' },
        fieldVersions: { newWordLimit: 2, retention: 1, note: 1 },
        deleted: false,
      },
    })
  })

  it('merges a stale write field by field: unrelated server changes survive', () => {
    const serverSide = applyPatch(initial, { baseVersion: 1, fields: { retention: 'intensive' } }, 2)
    if (!serverSide.accepted) throw new Error('unreachable')
    // A second device, still on version 1, edits only the limit.
    const result = applyPatch(serverSide.document, { baseVersion: 1, fields: { newWordLimit: 20 } }, 3)
    expect(result).toMatchObject({
      accepted: true,
      merged: true,
      document: { version: 3, fields: { newWordLimit: 20, retention: 'intensive', note: '' } },
    })
  })

  it('lets the write that reaches the server later win a field changed on both sides', () => {
    const first = applyPatch(initial, { baseVersion: 1, fields: { note: 'from the phone' } }, 2)
    if (!first.accepted) throw new Error('unreachable')
    const second = applyPatch(first.document, { baseVersion: 1, fields: { note: 'from the laptop' } }, 3)
    expect(second).toMatchObject({ accepted: true, merged: true, document: { fields: { note: 'from the laptop' } } })
    if (!second.accepted) throw new Error('unreachable')
    expect(second.document.fieldVersions.note).toBe(3)
  })

  it('ignores undefined fields in a patch', () => {
    // The type forbids it; a JavaScript caller can still send one.
    const fields = { note: undefined } as unknown as Partial<Settings>
    const result = applyPatch(initial, { baseVersion: 1, fields }, 2)
    expect(result).toMatchObject({ accepted: true, document: { fields: initial.fields, fieldVersions: initial.fieldVersions } })
  })

  it('tombstones and undeletes, keeping the fields throughout', () => {
    const deleted = applyPatch(initial, { baseVersion: 1, fields: {}, deleted: true }, 2)
    expect(deleted).toMatchObject({ accepted: true, document: { deleted: true, fields: initial.fields } })
    if (!deleted.accepted) throw new Error('unreachable')
    const restored = applyPatch(deleted.document, { baseVersion: 2, fields: {}, deleted: false }, 3)
    expect(restored).toMatchObject({ accepted: true, document: { deleted: false, fields: initial.fields, version: 3 } })
  })

  it('rejects a client write to a server-owned document', () => {
    const result = applyPatch(initial, { baseVersion: 1, fields: { note: 'x' } }, 2, 'server_owned')
    expect(result).toEqual({ accepted: false, reason: 'server_owned' })
  })

  it('rejects a base version the server has never issued, and a version that does not move forward', () => {
    expect(applyPatch(initial, { baseVersion: 5, fields: {} }, 6)).toEqual({ accepted: false, reason: 'base_ahead_of_server' })
    expect(applyPatch(initial, { baseVersion: 1, fields: {} }, 1)).toEqual({ accepted: false, reason: 'version_not_newer' })
  })
})

describe('mergeUnlockSets', () => {
  it('is union: nothing re-locks a unit', () => {
    expect(mergeUnlockSets(new Set(['a1-u1', 'a1-u2']), ['a1-u1', 'a2-u1'], [])).toEqual(new Set(['a1-u1', 'a1-u2', 'a2-u1']))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './documents'`.

- [ ] **Step 3: Implement**

`core/src/documents.ts`:

```ts
/**
 * Versioned documents: user words, settings, unit unlocks, word aliases,
 * word flags. Server-owned documents: the entitlement, league membership.
 * Only the server assigns versions (spec §9.2).
 */
export type DocumentClass = 'versioned' | 'server_owned'

export interface VersionedDocument<T extends object> {
  readonly version: number
  readonly fields: T
  /** Per field, the version at which it last changed: all the history a merge needs. */
  readonly fieldVersions: Readonly<Partial<Record<keyof T, number>>>
  /** A tombstone. Retained with its fields, so undeleting restores them. */
  readonly deleted: boolean
}

/** A client write: the changed fields only, plus the version it was editing. */
export interface DocumentPatch<T extends object> {
  readonly baseVersion: number
  readonly fields: Readonly<Partial<T>>
  /** True deletes, false undeletes, absent leaves the tombstone as it is. */
  readonly deleted?: boolean
}

export type PatchResult<T extends object> =
  | {
      readonly accepted: true
      readonly document: VersionedDocument<T>
      /** False when baseVersion was current; true when the write was merged field by field. */
      readonly merged: boolean
    }
  | { readonly accepted: false; readonly reason: 'server_owned' | 'base_ahead_of_server' | 'version_not_newer' }

export function createDocument<T extends object>(fields: T, version: number): VersionedDocument<T> {
  const fieldVersions: Partial<Record<keyof T, number>> = {}
  for (const key of Object.keys(fields) as (keyof T)[]) fieldVersions[key] = version
  return { version, fields, fieldVersions, deleted: false }
}

/**
 * Applies a client patch on the server. A current base is accepted outright.
 * A stale base is merged field by field: a field unchanged on the server since
 * the base is applied, and for a field changed on both sides the write that
 * reaches the server later — this one — wins. Either way, fields the patch
 * does not mention are kept, and ordering is by arrival, never by a client
 * clock (spec §9.2).
 */
export function applyPatch<T extends object>(
  document: VersionedDocument<T>,
  patch: DocumentPatch<T>,
  nextVersion: number,
  documentClass: DocumentClass = 'versioned',
): PatchResult<T> {
  if (documentClass === 'server_owned') return { accepted: false, reason: 'server_owned' }
  if (patch.baseVersion > document.version) return { accepted: false, reason: 'base_ahead_of_server' }
  if (nextVersion <= document.version) return { accepted: false, reason: 'version_not_newer' }
  const fields = { ...document.fields }
  const fieldVersions: Partial<Record<keyof T, number>> = { ...document.fieldVersions }
  for (const key of Object.keys(patch.fields) as (keyof T)[]) {
    const value = patch.fields[key]
    if (value === undefined) continue
    fields[key] = value as T[keyof T]
    fieldVersions[key] = nextVersion
  }
  return {
    accepted: true,
    merged: patch.baseVersion < document.version,
    document: { version: nextVersion, fields, fieldVersions, deleted: patch.deleted ?? document.deleted },
  }
}

/** `unit_unlock` is a grow-only set: merge is union, and nothing re-locks a unit (spec §9.2). */
export function mergeUnlockSets(...sets: Iterable<string>[]): Set<string> {
  const out = new Set<string>()
  for (const set of sets) for (const id of set) out.add(id)
  return out
}
```

Append to `core/src/index.ts`:

```ts
export * from './documents'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 169 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): versioned documents with field-level merge and tombstones"
```

---

### Task 9: Entitlement and the capability check

**Files:**
- Create: `core/src/entitlement.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/entitlement.test.ts`

**Interfaces:**
- Consumes: nothing from other modules.
- Produces: `ENTITLEMENT_TIERS`, `EntitlementTier`, `EntitlementSource`; `Entitlement` `{ tier, source, expiresAt: number | null, quotas: { enrichmentPerDay }, version, staleAfter }`; `CAPABILITIES`, `Capability`; `ENTITLEMENT_STALE_AFTER_MS`, `DEFAULT_ENRICHMENT_PER_DAY`, `DEFAULT_ENTITLEMENT`; `effectiveEntitlement(cached, now): Entitlement`; `canUse(capability, cached, now): boolean`; `isStale(cached, now): boolean`.

`canUse` is the one capability check (spec §8.8). A paid-or-free condition anywhere in `web/` is a defect. `client-data` (plan 4) supplies the cached document and `now`; the server (plan 5) issues every user `DEFAULT_ENTITLEMENT` with a version and a `staleAfter` of pull time plus `ENTITLEMENT_STALE_AFTER_MS`.

- [ ] **Step 1: Write the failing test**

`core/src/entitlement.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CAPABILITIES,
  canUse,
  DEFAULT_ENTITLEMENT,
  effectiveEntitlement,
  ENTITLEMENT_STALE_AFTER_MS,
  isStale,
  type Entitlement,
} from './entitlement'

const NOW = Date.UTC(2026, 0, 10, 12, 0)
const DAY = 86_400_000

const plus: Entitlement = {
  tier: 'plus',
  source: 'web',
  expiresAt: NOW + 30 * DAY,
  quotas: { enrichmentPerDay: 500 },
  version: 7,
  staleAfter: NOW + ENTITLEMENT_STALE_AFTER_MS,
}

describe('effectiveEntitlement', () => {
  it('falls back to the default with no cached copy', () => {
    expect(effectiveEntitlement(null, NOW)).toBe(DEFAULT_ENTITLEMENT)
    expect(effectiveEntitlement(undefined, NOW)).toBe(DEFAULT_ENTITLEMENT)
  })

  it('honours the cached copy until expiresAt, however stale, and not after', () => {
    const stale = { ...plus, staleAfter: NOW - 90 * DAY }
    expect(effectiveEntitlement(stale, NOW)).toBe(stale)
    expect(effectiveEntitlement(stale, plus.expiresAt! - 1)).toBe(stale)
    expect(effectiveEntitlement(stale, plus.expiresAt!)).toBe(DEFAULT_ENTITLEMENT)
  })

  it('never expires the default tier', () => {
    expect(DEFAULT_ENTITLEMENT.expiresAt).toBeNull()
    expect(effectiveEntitlement(DEFAULT_ENTITLEMENT, NOW + 10_000 * DAY)).toBe(DEFAULT_ENTITLEMENT)
  })
})

describe('canUse', () => {
  it('keeps studying free: every learner has theme collections and an enrichment allowance', () => {
    expect(canUse('collections.theme', null, NOW)).toBe(true)
    expect(canUse('enrichment', null, NOW)).toBe(true)
    expect(DEFAULT_ENTITLEMENT.quotas.enrichmentPerDay).toBeGreaterThan(0)
  })

  it('gates the extras on the cached entitlement, offline or on', () => {
    expect(canUse('capture.paste', null, NOW)).toBe(false)
    expect(canUse('collections.exam', DEFAULT_ENTITLEMENT, NOW)).toBe(false)
    expect(canUse('capture.paste', plus, NOW)).toBe(true)
    expect(canUse('capture.paste', plus, plus.expiresAt!)).toBe(false)
  })

  it('answers for every named capability', () => {
    for (const capability of CAPABILITIES) {
      expect(typeof canUse(capability, plus, NOW)).toBe('boolean')
      expect(canUse(capability, plus, NOW)).toBe(true)
    }
  })
})

describe('isStale', () => {
  it('asks for a refresh from staleAfter on, and always without a copy', () => {
    expect(isStale(null, NOW)).toBe(true)
    expect(isStale(plus, plus.staleAfter - 1)).toBe(false)
    expect(isStale(plus, plus.staleAfter)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './entitlement'`.

- [ ] **Step 3: Implement**

`core/src/entitlement.ts`:

```ts
/** One tier exists at launch; `plus` is the proposed second (spec §8.8, not approved). */
export const ENTITLEMENT_TIERS = ['free', 'plus'] as const
export type EntitlementTier = (typeof ENTITLEMENT_TIERS)[number]

/** Where the entitlement came from. Nothing else in the system knows a provider exists. */
export type EntitlementSource = 'default' | 'app_store' | 'play' | 'web' | 'grant'

/** The server-owned synced document (spec §8.8, §9.2). Read-only on clients. */
export interface Entitlement {
  readonly tier: EntitlementTier
  readonly source: EntitlementSource
  /** When the entitlement itself ends; null never. Not the cache's staleness. */
  readonly expiresAt: number | null
  readonly quotas: {
    readonly enrichmentPerDay: number
  }
  readonly version: number
  /** When the client should try to refresh its copy. A stale copy is still honoured. */
  readonly staleAfter: number
}

/** The named capabilities the one capability check knows (spec §8.8). Tuning (§15). */
export const CAPABILITIES = [
  'collections.theme',
  'collections.exam',
  'capture.paste',
  'capture.share',
  'capture.import',
  'capture.extension',
  'forecast',
  'streak.extra_freezes',
  'enrichment',
] as const
export type Capability = (typeof CAPABILITIES)[number]

const TIER_CAPABILITIES: Readonly<Record<EntitlementTier, ReadonlySet<Capability>>> = {
  free: new Set<Capability>(['collections.theme', 'enrichment']),
  plus: new Set<Capability>(CAPABILITIES),
}

/** How long a pulled copy is fresh for. Tuning (§15). */
export const ENTITLEMENT_STALE_AFTER_MS = 24 * 60 * 60 * 1000

/** Quota of the free tier. Tuning (§15). */
export const DEFAULT_ENRICHMENT_PER_DAY = 20

/** What every learner holds, and what a client falls back to after `expiresAt`. */
export const DEFAULT_ENTITLEMENT: Entitlement = {
  tier: 'free',
  source: 'default',
  expiresAt: null,
  quotas: { enrichmentPerDay: DEFAULT_ENRICHMENT_PER_DAY },
  version: 0,
  staleAfter: 0,
}

/**
 * The entitlement in force: the cached copy until its `expiresAt`, online or
 * off and however stale the copy; the default after (spec §8.8).
 */
export function effectiveEntitlement(cached: Entitlement | null | undefined, now: number): Entitlement {
  if (!cached) return DEFAULT_ENTITLEMENT
  if (cached.expiresAt !== null && now >= cached.expiresAt) return DEFAULT_ENTITLEMENT
  return cached
}

/** The one capability check. Nothing else asks whether a learner is paying. */
export function canUse(capability: Capability, cached: Entitlement | null | undefined, now: number): boolean {
  return TIER_CAPABILITIES[effectiveEntitlement(cached, now).tier].has(capability)
}

/** Whether the client should try to refresh its copy. Says nothing about what is honoured. */
export function isStale(cached: Entitlement | null | undefined, now: number): boolean {
  return !cached || now >= cached.staleAfter
}
```

Append to `core/src/index.ts`:

```ts
export * from './entitlement'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 176 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): entitlement and the one capability check"
```

---

### Task 10: Progress: retention rate, unit markers, level completion

**Files:**
- Create: `core/src/progress.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/progress.test.ts`

**Interfaces:**
- Consumes: `DaySummary` (Task 3); `masteryTier`, `TIER_MIN_STABILITY_DAYS` (plan 1); `isLive`, `PathContext` (plan 1); `ReviewState.passedOnLaterDay` (Task 1); `Unit`, `CefrLevel`, `levelIndex`.
- Produces: `RETENTION_WINDOW_DAYS`; `retentionRate(summaries, today, windowDays?): number | null`; `UNIT_COMPLETE_SHARE`, `UNIT_MASTERED_SHARE`; `UnitProgress` `{ live, introduced, passed, mature, complete, mastered }` and `unitProgress(unit, states, ctx)`; `LevelCompletion` (`{ kind: 'skipped' }` or `{ kind: 'progress', live, mature, share }`) and `levelCompletion(level, units, states, ctx)`.

- [ ] **Step 1: Write the failing test**

`core/src/progress.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DaySummary } from './activity'
import { TIER_MIN_STABILITY_DAYS } from './mastery'
import { levelCompletion, retentionRate, unitProgress } from './progress'
import { applyGrade, localDay, type ReviewState } from './scheduler'
import { Grade, type CefrLevel, type Unit, type WordFlag } from './types'
import { corpusWordId, type WordId } from './wordId'

const w = (n: number) => corpusWordId(`en-${String(n).padStart(6, '0')}`)
const TZ = 120
const at = (day: number, hour: number) => Date.UTC(2026, 0, 5 + day, hour) - TZ * 60_000
const TODAY = localDay(at(40, 12), TZ)
const unit = (unitId: string, level: CefrLevel, order: number, ids: number[]): Unit => ({ unitId, level, order, wordIds: ids.map(w) })

/** Introduced on day 0 and, if `passed`, rated Good on day 3; `stability` overrides the result. */
function state(n: number, passed: boolean, stability?: number): [WordId, ReviewState] {
  let s = applyGrade(null, w(n), Grade.Good, at(0, 10), TZ)
  if (passed) s = applyGrade(s, w(n), Grade.Good, at(3, 10), TZ)
  return [w(n), stability === undefined ? s : { ...s, stability }]
}

const visible = { retired: new Set<WordId>(), flags: new Map<WordId, WordFlag>() }

describe('retentionRate', () => {
  const summary = (day: number, reviews: number, successes: number): DaySummary => ({ day, reviews, successes, newWords: 0 })

  it('is null until a review has been counted', () => {
    expect(retentionRate([], TODAY)).toBeNull()
    expect(retentionRate([summary(TODAY, 0, 0)], TODAY)).toBeNull()
  })

  it('is first-attempt successes over reviews in the trailing 30 days, today included', () => {
    const days = [summary(TODAY, 4, 3), summary(TODAY - 29, 6, 3), summary(TODAY - 30, 10, 0), summary(TODAY + 1, 10, 0)]
    expect(retentionRate(days, TODAY)).toBeCloseTo(6 / 10, 10)
    expect(retentionRate(days, TODAY, 1)).toBeCloseTo(3 / 4, 10)
  })
})

describe('unitProgress', () => {
  const u = unit('a1-u1', 'A1', 1, [1, 2, 3, 4, 5])

  it('counts live, introduced, passed and mature words', () => {
    const states = new Map([state(1, true), state(2, true, TIER_MIN_STABILITY_DAYS.mature), state(3, false)])
    expect(unitProgress(u, states, visible)).toEqual({ live: 5, introduced: 3, passed: 2, mature: 1, complete: false, mastered: false })
  })

  it('is complete at 80% passed on a later day and mastered at 90% mature', () => {
    const four = new Map([state(1, true), state(2, true), state(3, true), state(4, true), state(5, false)])
    expect(unitProgress(u, four, visible).complete).toBe(true)
    const mature = new Map([1, 2, 3, 4, 5].map((n) => state(n, true, TIER_MIN_STABILITY_DAYS.mature)))
    expect(unitProgress(u, mature, visible)).toMatchObject({ complete: true, mastered: true })
    const fourMature = new Map([...mature].map(([id, s], i) => [id, i === 4 ? { ...s, stability: 1 } : s] as const))
    expect(unitProgress(u, fourMature, visible).mastered).toBe(false)
  })

  it('leaves retired, known and suspended words out, so a known word is never mature', () => {
    const states = new Map([state(1, true, 100), state(2, true, 100), state(3, true, 100), state(4, true, 100)])
    const ctx = { retired: new Set([w(5)]), flags: new Map<WordId, WordFlag>([[w(4), 'known'], [w(3), 'suspended']]) }
    expect(unitProgress(u, states, ctx)).toEqual({ live: 2, introduced: 2, passed: 2, mature: 2, complete: true, mastered: true })
  })

  it('is neither complete nor mastered with no live word', () => {
    const ctx = { retired: new Set(u.wordIds), flags: new Map() }
    expect(unitProgress(u, new Map(), ctx)).toMatchObject({ live: 0, complete: false, mastered: false })
  })
})

describe('levelCompletion', () => {
  const units = [unit('a1-u1', 'A1', 1, [1, 2]), unit('a1-u2', 'A1', 2, [3, 4]), unit('a2-u1', 'A2', 3, [5, 6])]

  it('is the share of the band’s live entries that are mature', () => {
    const states = new Map([state(1, true, 30), state(2, true, 30), state(3, true, 30), state(5, true, 30)])
    expect(levelCompletion('A1', units, states, { ...visible, declaredLevel: 'A1' })).toEqual({ kind: 'progress', live: 4, mature: 3, share: 0.75 })
    expect(levelCompletion('A2', units, states, { ...visible, declaredLevel: 'A1' })).toEqual({ kind: 'progress', live: 2, mature: 1, share: 0.5 })
  })

  it('shows a band below the declared level as skipped, never as 100%', () => {
    const states = new Map([1, 2, 3, 4].map((n) => state(n, true, 30)))
    expect(levelCompletion('A1', units, states, { ...visible, declaredLevel: 'A2' })).toEqual({ kind: 'skipped' })
    expect(levelCompletion('A2', units, states, { ...visible, declaredLevel: 'A2' })).toEqual({ kind: 'progress', live: 2, mature: 0, share: 0 })
  })

  it('is zero, not NaN, for a band with no live entry', () => {
    expect(levelCompletion('B1', units, new Map(), { ...visible, declaredLevel: 'A1' })).toEqual({ kind: 'progress', live: 0, mature: 0, share: 0 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './progress'`.

- [ ] **Step 3: Implement**

`core/src/progress.ts`:

```ts
import type { DaySummary } from './activity'
import { masteryTier } from './mastery'
import { isLive, type PathContext } from './path'
import type { ReviewState } from './scheduler'
import { levelIndex, type CefrLevel, type Unit } from './types'
import type { WordId } from './wordId'

export const RETENTION_WINDOW_DAYS = 30

/**
 * Share of first-attempt successes among scheduled reviews of words last seen
 * on an earlier day, over the trailing window ending today (spec §8.3). Null
 * until there is a review to count.
 */
export function retentionRate(
  summaries: Iterable<DaySummary>,
  today: number,
  windowDays: number = RETENTION_WINDOW_DAYS,
): number | null {
  let reviews = 0
  let successes = 0
  for (const s of summaries) {
    if (s.day <= today - windowDays || s.day > today) continue
    reviews += s.reviews
    successes += s.successes
  }
  return reviews === 0 ? null : successes / reviews
}

/** Shares of a unit's live words for the two cosmetic markers (spec §7.2). Tuning (§15). */
export const UNIT_COMPLETE_SHARE = 0.8
export const UNIT_MASTERED_SHARE = 0.9

export interface UnitProgress {
  readonly live: number
  readonly introduced: number
  /** Live words with a successful non-practice review on a later day. */
  readonly passed: number
  readonly mature: number
  readonly complete: boolean
  readonly mastered: boolean
}

type Visibility = Pick<PathContext, 'retired' | 'flags'>

/** A known word is known-by-declaration, never mature; flags are excluded by `isLive` first. */
function stateOf(wordId: WordId, states: ReadonlyMap<WordId, ReviewState>, ctx: Visibility): ReviewState | null {
  return isLive(wordId, ctx) ? (states.get(wordId) ?? null) : null
}

export function unitProgress(unit: Unit, states: ReadonlyMap<WordId, ReviewState>, ctx: Visibility): UnitProgress {
  let live = 0
  let introduced = 0
  let passed = 0
  let mature = 0
  for (const wordId of unit.wordIds) {
    if (!isLive(wordId, ctx)) continue
    live += 1
    const state = stateOf(wordId, states, ctx)
    if (!state) continue
    introduced += 1
    if (state.passedOnLaterDay) passed += 1
    if (masteryTier(state) === 'mature') mature += 1
  }
  return {
    live,
    introduced,
    passed,
    mature,
    complete: live > 0 && passed >= UNIT_COMPLETE_SHARE * live,
    mastered: live > 0 && mature >= UNIT_MASTERED_SHARE * live,
  }
}

export type LevelCompletion =
  /** A band below the declared level: "skipped — placed above", never 100% (spec §7.2). */
  | { readonly kind: 'skipped' }
  | { readonly kind: 'progress'; readonly live: number; readonly mature: number; readonly share: number }

/** The share of a CEFR band's live entries that are mature (spec §8.3). */
export function levelCompletion(
  level: CefrLevel,
  units: readonly Unit[],
  states: ReadonlyMap<WordId, ReviewState>,
  ctx: Visibility & Pick<PathContext, 'declaredLevel'>,
): LevelCompletion {
  if (levelIndex(level) < levelIndex(ctx.declaredLevel)) return { kind: 'skipped' }
  let live = 0
  let mature = 0
  for (const unit of units) {
    if (unit.level !== level) continue
    const progress = unitProgress(unit, states, ctx)
    live += progress.live
    mature += progress.mature
  }
  return { kind: 'progress', live, mature, share: live === 0 ? 0 : mature / live }
}
```

Append to `core/src/index.ts`:

```ts
export * from './progress'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 185 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): retention rate, unit markers and level completion"
```

---

### Task 11: Placement test scoring

**Files:**
- Create: `core/src/placement.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/placement.test.ts`

**Interfaces:**
- Consumes: `shuffle`, `Rng`, `seededRng` (plan 1); `CEFR_LEVELS`, `CefrLevel`; `WordId`.
- Produces: `PLACEMENT_PROBE_SIZE`, `PLACEMENT_PASS_MIN`; `PlacementAnswer` `{ wordId, level, correct }`; `PlacementProgress` `{ probing: CefrLevel | null, remainingInProbe, result: CefrLevel | null }`; `placementProgress(answers): PlacementProgress`; `nextPlacementWords(answers, pool: ReadonlyMap<CefrLevel, readonly WordId[]>, rng): WordId[]`.

The web client (plan 6) keeps the answers in memory, asks the first word `nextPlacementWords` returns as a multiple-choice item, appends the answer, and stops when `result` is set; it then writes `result` as the declared level. `pool` is every live, non-retired corpus entry grouped by level. If a band cannot supply a word (an empty `nextPlacementWords` while `probing` is set), the client ends the test and lets the learner declare a level.

- [ ] **Step 1: Write the failing test**

`core/src/placement.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextPlacementWords, PLACEMENT_PASS_MIN, PLACEMENT_PROBE_SIZE, placementProgress, type PlacementAnswer } from './placement'
import { seededRng } from './rng'
import { CEFR_LEVELS, type CefrLevel } from './types'
import { corpusWordId, type WordId } from './wordId'

const pool = new Map<CefrLevel, readonly WordId[]>(
  CEFR_LEVELS.map((level, i) => [level, Array.from({ length: 12 }, (_, k) => corpusWordId(`${level}-${i * 100 + k}`))]),
)

/** Answers the whole probe of `level`, `right` of them correctly, using the pool's words in order. */
function probe(level: CefrLevel, right: number, from: PlacementAnswer[] = []): PlacementAnswer[] {
  const words = pool.get(level)!
  const out = [...from]
  for (let i = 0; i < PLACEMENT_PROBE_SIZE; i += 1) {
    if (placementProgress(out).probing !== level) break
    out.push({ wordId: words[i]!, level, correct: i < right })
  }
  return out
}

describe('placementProgress', () => {
  it('starts in the middle band with a whole probe to answer', () => {
    expect(placementProgress([])).toEqual({ probing: 'B1', remainingInProbe: PLACEMENT_PROBE_SIZE, result: null })
  })

  it('places a learner who passes every band at the highest', () => {
    const answers = probe('B2', 8, probe('B1', 8))
    expect(placementProgress(answers)).toEqual({ probing: null, remainingInProbe: 0, result: 'C1' })
  })

  it('places a learner at the lowest band they fail', () => {
    expect(placementProgress(probe('B2', 3, probe('B1', 8))).result).toBe('B2')
    expect(placementProgress(probe('A2', 7, probe('B1', 2))).result).toBe('B1')
    expect(placementProgress(probe('A1', 6, probe('A2', 5, probe('B1', 0)))).result).toBe('A2')
    expect(placementProgress(probe('A1', 1, probe('A2', 1, probe('B1', 1)))).result).toBe('A1')
  })

  it('decides a probe as soon as it can, so the test stays short', () => {
    const b1 = pool.get('B1')!
    const sixRight = b1.slice(0, PLACEMENT_PASS_MIN).map((wordId) => ({ wordId, level: 'B1' as const, correct: true }))
    expect(placementProgress(sixRight).probing).toBe('B2')
    const threeWrong = b1.slice(0, 3).map((wordId) => ({ wordId, level: 'B1' as const, correct: false }))
    expect(placementProgress(threeWrong).probing).toBe('A2')
    expect(placementProgress(threeWrong.slice(0, 2))).toEqual({ probing: 'B1', remainingInProbe: 6, result: null })
    expect(placementProgress(sixRight.slice(0, 4))).toEqual({ probing: 'B1', remainingInProbe: 4, result: null })
  })

  it('needs at most three probes', () => {
    for (const right of [0, 8]) {
      for (const right2 of [0, 8]) {
        for (const right3 of [0, 8]) {
          const answers = probe(placementProgress([]).probing!, right)
          const two = probe(placementProgress(answers).probing ?? 'A1', right2, answers)
          const three = placementProgress(two).probing === null ? two : probe(placementProgress(two).probing!, right3, two)
          expect(placementProgress(three).result).not.toBeNull()
          expect(three.length).toBeLessThanOrEqual(3 * PLACEMENT_PROBE_SIZE)
        }
      }
    }
  })

  it('rejects an answer from a band it is not probing', () => {
    expect(() => placementProgress([{ wordId: corpusWordId('x'), level: 'A1', correct: true }])).toThrow(/B1/)
  })
})

describe('nextPlacementWords', () => {
  it('draws unasked words from the band being probed, as many as the probe still needs', () => {
    const asked = probe('B1', 8).slice(0, 2)
    const next = nextPlacementWords(asked, pool, seededRng(1))
    expect(next).toHaveLength(placementProgress(asked).remainingInProbe)
    for (const id of next) {
      expect(pool.get('B1')).toContain(id)
      expect(asked.map((a) => a.wordId)).not.toContain(id)
    }
  })

  it('is reproducible for a seed and different across seeds', () => {
    expect(nextPlacementWords([], pool, seededRng(3))).toEqual(nextPlacementWords([], pool, seededRng(3)))
    expect(nextPlacementWords([], pool, seededRng(3))).not.toEqual(nextPlacementWords([], pool, seededRng(4)))
  })

  it('gives fewer when the band runs dry, and none once the test is decided', () => {
    const small = new Map<CefrLevel, readonly WordId[]>([['B1', [corpusWordId('only')]]])
    expect(nextPlacementWords([], small, seededRng(1))).toEqual([corpusWordId('only')])
    expect(nextPlacementWords(probe('B2', 8, probe('B1', 8)), pool, seededRng(1))).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './placement'`.

- [ ] **Step 3: Implement**

`core/src/placement.ts`:

```ts
import { shuffle, type Rng } from './rng'
import { CEFR_LEVELS, type CefrLevel } from './types'
import type { WordId } from './wordId'

/** Words asked per band, and how many must be right for the band to count as known. Tuning (§15). */
export const PLACEMENT_PROBE_SIZE = 8
export const PLACEMENT_PASS_MIN = 6

export interface PlacementAnswer {
  readonly wordId: WordId
  /** The band the word was drawn from. */
  readonly level: CefrLevel
  readonly correct: boolean
}

export interface PlacementProgress {
  /** The band being probed, or null once the test is decided. */
  readonly probing: CefrLevel | null
  /** Answers the current probe can still take before it is decided either way. */
  readonly remainingInProbe: number
  /** The level to place the learner at: the lowest band they did not pass. */
  readonly result: CefrLevel | null
}

/**
 * A binary search over the bands for the lowest one the learner does not know,
 * from the answers so far in order (spec §7.2). A probe ends as soon as it is
 * decided: PLACEMENT_PASS_MIN right passes it, more than
 * PLACEMENT_PROBE_SIZE − PLACEMENT_PASS_MIN wrong fails it. Passing every band
 * places the learner at the highest.
 */
export function placementProgress(answers: readonly PlacementAnswer[]): PlacementProgress {
  const maxWrong = PLACEMENT_PROBE_SIZE - PLACEMENT_PASS_MIN
  let lo = 0
  let hi = CEFR_LEVELS.length - 1
  let i = 0
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const band = CEFR_LEVELS[mid]!
    let right = 0
    let wrong = 0
    while (right < PLACEMENT_PASS_MIN && wrong <= maxWrong) {
      const answer = answers[i]
      if (!answer) return { probing: band, remainingInProbe: PLACEMENT_PROBE_SIZE - right - wrong, result: null }
      if (answer.level !== band) throw new Error(`Expected an answer from ${band}, got ${answer.level}`)
      i += 1
      if (answer.correct) right += 1
      else wrong += 1
    }
    if (right >= PLACEMENT_PASS_MIN) lo = mid + 1
    else hi = mid
  }
  return { probing: null, remainingInProbe: 0, result: CEFR_LEVELS[lo]! }
}

/**
 * Words to ask next, drawn at random from the band being probed, never one
 * already asked: at most `remainingInProbe`, fewer only if the band has no
 * more words to give, and none once the test is decided.
 */
export function nextPlacementWords(
  answers: readonly PlacementAnswer[],
  pool: ReadonlyMap<CefrLevel, readonly WordId[]>,
  rng: Rng,
): WordId[] {
  const progress = placementProgress(answers)
  if (progress.probing === null) return []
  const asked = new Set(answers.map((a) => a.wordId))
  const candidates = (pool.get(progress.probing) ?? []).filter((id) => !asked.has(id))
  return shuffle(candidates, rng).slice(0, progress.remainingInProbe)
}
```

Append to `core/src/index.ts`:

```ts
export * from './placement'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 194 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Verify the purity guard still holds**

```bash
printf "export const leak = () => [fetch('x'), process.env, document.title]\n" > core/src/_leak.ts
pnpm typecheck; rm core/src/_leak.ts
```

Expected: `tsc` reports `Cannot find name 'fetch'`, `'process'` and `'document'`, and the typecheck fails. If it passes, the compiler options have been loosened — restore `"lib": ["ES2022"]` and `"types": []` in `tsconfig.base.json`.

- [ ] **Step 6: Commit**

```bash
git add core/src
git commit -m "feat(core): placement test scoring and item selection"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| §4.3 the rebase rule: a pull never rolls back answers above the device's mark | 7 |
| §7.2 placement test: binary search across bands, ~30 items, the level placed at | 11 |
| §7.2 unit complete (80 % passed on a later day) and unit mastered (90 % mature); "skipped — placed above" | 1, 10 |
| §7.4 `reviewsDoneToday` and `newWordsDoneToday` as one shared count | 3 |
| §8.3 retention rate over the trailing 30 days, first attempts only; the daily summary a pull carries; level completion | 3, 10 |
| §8.4 day complete: capped due figure or goal, at least one answer; `day_complete` recorded, not re-derived; streaks and freezes from the set of dates; a late date repairs, never breaks | 5 |
| §8.7 fixed XP per new word and due review, grade-blind; first scheduled review of the day only; reduced practice XP; per-UTC-day cap; ineligible events earn nothing | 4 |
| §8.8 entitlement as a server-owned document; `expires_at` vs `stale_after`; one capability check; provider-agnostic `source`; fallback to the default tier | 9 |
| §9.2 effective time: one window per push, whole-clock correction stays eligible, never-seen device and demo, individual clamping, order restored, `effective_ts` immutable | 6 |
| §9.2 versioned documents: patches with `base_version`, field-level merge by arrival, tombstones, undelete; server-owned writes rejected; `unit_unlock` is union | 8 |
| §9.2 a tombstoned user word derives no state; a merged user word's events regroup under the entry | 7 |
| §10 XP-ineligible: below the plausibility floor, individually clamped, or too dense; still replayed; XP recomputed, never incremented | 4, 6 |
| §13 XP: a word answered *Again* five times in a day earns once; streaks unchanged by anything but dates; stamping properties; rebase property; a client write to a server-owned document is rejected; a cached entitlement honoured until `expires_at` and not after | 4, 5, 6, 7, 8, 9 |

## Contracts this plan hands to the later plans

- **`ReplayEvent.effectiveTs` for an unstamped event is its `clientTs`** (plan 4). `client-data` sets it when it reads the outbox; it also passes the pulled review state as `ActivityOptions.prior` and `ReplayOptions.prior`, and today's local events, when it counts the day or rebases.
- **The daily summary is served per local day** (plan 5): the server runs `summarizeDays(classifyEvents(events above the server's marks, { prior }))` — the same set `rebase` re-applies — and sends the trailing 90 days; the client merges it with `summarizeDays` of its unsynced events through `mergeSummaries`, then calls `retentionRate`.
- **`day_complete.local_date` is stored as `dayToIsoDate(localDate)`** (plans 4, 5). The server accepts a `DayCompleteEvent` only if the log holds at least one answer on that local date (spec §8.4).
- **One window per `push_id`** (plan 5): `openPushWindow` on the first page, `stampEvents` on every page with the stored window. Duplicates on `review_id` are dropped before stamping; `device.last_accepted` advances to the highest stamped `(deviceSeq, effectiveTs)`.
- **`applyPatch` is called in the transaction that stores the document** (plan 5), with `nextVersion` from the document's own counter. A `server_owned` class is stored per document type, not per write.
- **`DEFAULT_ENTITLEMENT` is what the server issues** (plan 5), with a real `version` and `staleAfter = receivedAt + ENTITLEMENT_STALE_AFTER_MS`. `canUse` is the only place `web/` may ask about a capability (plan 6).
- **`ReviewState` grew two fields** (`introducedDay`, `passedOnLaterDay`). The server's `review_state` table (plan 5) stores both; the client's local schema (plan 4) does too.
- **Today's counts after a pull** (plan 4): `DayCounts` for today = the pulled `DaySummary` for today (`reviews`, `newWords`, `answered`, `practice`) plus `dayCounts(classifyEvents(events above the marks, { prior }), today)`, field by field.
- **Offline XP is provisional** (plan 4): `computeXp(events above the marks, { prior })` cannot see XP other devices earned today, so the display may exceed the cap until the next pull.
- **One push, one device** (plan 5): a push carries one device's events; `stampEvents` threads `StampCarry` from page to page, seeded empty on the first page (the window's lower bound already covers the previous push).
- **A tombstoned word's next answer after an undelete** classifies as `new` on a client whose `prior` came from a pull (server state omits tombstoned words) and as `review` on the server; the server's XP is authoritative (plans 4, 5).

Left for later plans: XP amounts by league week and late-event cut-off (Phase 1b, spec §8.5); the three-record merge of a user word into a corpus entry (plan 5, on plan 3's user-word shape); validation of settings, offsets and aliases at ingest (plans 4, 5, per the roadmap).
