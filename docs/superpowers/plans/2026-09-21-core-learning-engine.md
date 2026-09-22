# Core Learning Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `core` package's learning engine — the pure TypeScript rules that decide what a learner studies, how an answer is graded, and what state the event log derives.

**Architecture:** A pnpm workspace whose first package, `@wordado/core`, has no I/O, no framework and no platform APIs. Review state is never edited: it is derived by replaying immutable review events through FSRS, so replay is a pure function of the *set* of events. Everything that varies at runtime — the clock, randomness, which modes can run — is passed in by the caller.

**Tech Stack:** Node 24, pnpm 12, TypeScript 7, Vitest 5, fast-check 4, ts-fsrs 5.4.2 (FSRS-6).

> **Revised 2026-09-21 after the whole-branch review.** The code blocks below are the code as merged, not as first planned. The review changed the scheduler to count in the learner's local calendar days (it first used 24-hour instants, which served reviews a day late), made replay ignore matching events by mode, stopped an exhausted collection from blocking the path, made the path queue apply unlocks itself, and hardened the version pin. `SCHEDULER_VERSION` is `r2` for that reason.

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md` — this plan implements §6.1 (word IDs), §7.1–§7.5, the distractor and matching rules of §8.1, the tiers of §8.3, and the replay half of §9.2. It is plan 1 of 8; see `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`.

## Global Constraints

- `core` is pure: no I/O, no framework, no platform APIs (spec §4.1). `tsconfig.base.json`, which `core/tsconfig.json` extends, sets `"lib": ["ES2022"]` and `"types": []`, so `fetch`, `process`, `document` and `localStorage` do not compile. Do not loosen it.
- `core` never reads the clock, never calls `Math.random`, and never depends on the host locale. Times arrive as arguments (epoch milliseconds, `number`); randomness arrives as an `Rng`.
- Scheduling counts in the learner's **local calendar days** (spec §8.4): `localDay(ts, clientTzOffsetMin)`, where the offset is minutes to add to UTC (UTC+2 → `120`, the negation of `getTimezoneOffset()`) and is stored in every event, so client and server derive the same days. There is one notion of due: `isDue`.
- Any change to a scheduling rule or FSRS parameter is a `SCHEDULER_VERSION` bump (spec §4.3). Mastery-tier thresholds are presentational and are not.
- A grade stored in an event is a fact and is never recomputed. Events are immutable; replay never rewrites them (spec §4.3, §6.1).
- Practice events never touch review state (spec §7.4). Binary modes never grade *Easy* (spec §7.3).
- `ts-fsrs` is pinned to exactly `5.4.2`; the version is part of `SCHEDULER_VERSION`.
- Phase 1 modes only: `flashcard`, `multiple_choice`, `listening_select`, `matching`.
- Code style: no semicolons, single quotes, 2-space indent, named exports only, `readonly` on every interface field.
- Every task ends with `pnpm test` and `pnpm typecheck` green from the repository root.

## Tuning values settled here (spec §15)

| Item | Value | Where |
|---|---|---|
| Slow-answer threshold, multiple choice and listening (select) | 8 000 ms | `grading.ts` |
| Desired retention: relaxed / standard / intensive | 0.85 / 0.90 / 0.94 | `scheduler.ts` |
| Same-day return after *Again* | 10 minutes | `scheduler.ts` |
| A scheduling day | the learner's local calendar day, from the event's `clientTzOffsetMin` | `scheduler.ts` |
| A lapse | an *Again* on a word whose last grade was not *Again* | `scheduler.ts` |
| Mastery tiers by stability: learning < 4 d ≤ young < 21 d ≤ mature | 4, 21 | `mastery.ts` |
| Daily new-word limit: default / maximum | 10 / 30 | `session.ts` |
| Daily review cap default | 100 | `session.ts` |

With these values a word rated *Good* twice, two days apart, reaches *young* (stability ≈ 11 days), which is when mode selection moves it from recognition to recall.

## File Structure

```
package.json                 workspace root: scripts, shared dev dependencies
pnpm-workspace.yaml          lists packages (only core for now)
tsconfig.base.json           strict compiler options shared by every package
.gitignore
core/
  package.json               @wordado/core; depends on ts-fsrs only
  tsconfig.json              extends the base; no DOM, no Node types
  vitest.config.ts
  src/
    index.ts                 re-exports every module below
    wordId.ts                c:/u: namespaced identifiers            (§6.1)
    types.ts                 Grade, Mode, CefrLevel, CorpusEntry, Unit, ReviewEvent
    grading.ts               answer outcome → grade                  (§7.3)
    scheduler.ts             FSRS wrapper, due dates, retention      (§7.1)
    replay.ts                events → review state                   (§9.2)
    mastery.ts               new / learning / young / mature         (§8.3)
    rng.ts                   injectable randomness
    modeSelection.ts         recognition → recall escalation         (§7.5)
    path.ts                  unit unlocks, assumed known, path queue (§7.2)
    session.ts               due reviews, new words, backlog cap     (§7.4)
    distractors.ts           wrong options, matching boards          (§8.1)
    *.test.ts                one test file beside each module
```

Each module has one responsibility and depends only on modules above it in this list.

---

### Task 1: Workspace and word IDs

**Files:**
- Create: `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- Create: `core/package.json`, `core/tsconfig.json`, `core/vitest.config.ts`
- Create: `core/src/wordId.ts`, `core/src/index.ts`
- Test: `core/src/wordId.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `` type WordId = `c:${string}` | `u:${string}` ``; `corpusWordId(entryId: string): WordId`; `userWordId(uuid: string): WordId`; `isWordId(value: string): value is WordId`; `toWordId(value: string): WordId` (throws); `parseWordId(id: WordId): { kind: 'corpus' | 'user'; key: string }`.

- [ ] **Step 1: Initialise the repository**

```bash
git init -b main
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.DS_Store
.env
.env.*
.wrangler/
.dev.vars
```

- [ ] **Step 2: Create the workspace root**

`package.json`:

```json
{
  "name": "wordado",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.4.2",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^7.0.2",
    "vitest": "^5.0.1"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - core
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": [],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

- [ ] **Step 3: Create the `core` package**

`core/package.json`:

```json
{
  "name": "@wordado/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "ts-fsrs": "5.4.2"
  },
  "devDependencies": {
    "fast-check": "^4.10.2"
  }
}
```

`core/tsconfig.json` — `lib` and `types` come from the base and are what keep platform APIs out of `core`:

```json
{
  "extends": "../tsconfig.base.json",
  "include": ["src"]
}
```

`core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: Install**

Run: `pnpm install`
Expected: finishes with `Done`, and creates `pnpm-lock.yaml`.

- [ ] **Step 5: Write the failing test**

`core/src/wordId.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { corpusWordId, isWordId, parseWordId, toWordId, userWordId } from './wordId'

describe('wordId', () => {
  it('namespaces corpus entries and user words', () => {
    expect(corpusWordId('en-000123')).toBe('c:en-000123')
    expect(userWordId('0b9c2f4e-1111-4222-8333-444455556666')).toBe(
      'u:0b9c2f4e-1111-4222-8333-444455556666',
    )
  })

  it('round-trips through parse', () => {
    expect(parseWordId(corpusWordId('en-000123'))).toEqual({ kind: 'corpus', key: 'en-000123' })
    expect(parseWordId(userWordId('abc'))).toEqual({ kind: 'user', key: 'abc' })
  })

  it('rejects anything outside the two namespaces', () => {
    for (const bad of ['', 'c:', 'u:', 'x:1', 'c:has space', 'en-000123', 'c::1']) {
      expect(isWordId(bad)).toBe(false)
      expect(() => toWordId(bad)).toThrow(/Invalid word_id/)
    }
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './wordId'`.

- [ ] **Step 7: Implement**

`core/src/wordId.ts`:

```ts
/**
 * A single namespaced identifier for anything reviewable (spec §6.1).
 * `c:<entry_id>` is a corpus entry; `u:<uuid>` is a standalone user word.
 */
export type WordId = `c:${string}` | `u:${string}`

export type WordKind = 'corpus' | 'user'

const PATTERN = /^(c|u):([A-Za-z0-9][A-Za-z0-9._-]*)$/

export function corpusWordId(entryId: string): WordId {
  return toWordId(`c:${entryId}`)
}

export function userWordId(uuid: string): WordId {
  return toWordId(`u:${uuid}`)
}

export function isWordId(value: string): value is WordId {
  return PATTERN.test(value)
}

export function toWordId(value: string): WordId {
  if (!isWordId(value)) throw new Error(`Invalid word_id: ${JSON.stringify(value)}`)
  return value
}

export function parseWordId(wordId: WordId): { kind: WordKind; key: string } {
  const match = PATTERN.exec(wordId)
  if (!match) throw new Error(`Invalid word_id: ${JSON.stringify(wordId)}`)
  return { kind: match[1] === 'c' ? 'corpus' : 'user', key: match[2]! }
}
```

`core/src/index.ts`:

```ts
export * from './wordId'
```

- [ ] **Step 8: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 3 tests pass; `tsc` prints nothing.

- [ ] **Step 9: Commit**

```bash
git add .gitignore package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json core docs
git commit -m "chore: workspace scaffold and core word IDs"
```

---

### Task 2: Shared types and grade mapping

**Files:**
- Create: `core/src/types.ts`, `core/src/grading.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/grading.test.ts`

**Interfaces:**
- Consumes: `WordId` from Task 1.
- Produces, from `types.ts`: `Grade` (const object `{ Again: 1, Hard: 2, Good: 3, Easy: 4 }` and the union type of its values); `Mode`; `Direction`; `CEFR_LEVELS`; `CefrLevel`; `levelIndex(level): number`; `WordFlag = 'known' | 'suspended'`; `CorpusEntry`; `Unit`; `ReviewEvent`; `StampedReviewEvent`.
- Produces, from `grading.ts`: `AnswerOutcome`; `GradingOptions { latencyGrading: boolean }`; `SLOW_THRESHOLD_MS: Record<Mode, number>`; `gradeAnswer(mode: Mode, outcome: AnswerOutcome, options: GradingOptions): Grade`.

- [ ] **Step 1: Write the shared types**

These have no behaviour of their own; the grading tests below exercise them. `core/src/types.ts`:

```ts
import type { WordId } from './wordId'

/** FSRS grades. The numeric values are the ones FSRS uses. */
export const Grade = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const
export type Grade = (typeof Grade)[keyof typeof Grade]

/** Phase 1 game modes (spec §8.1). Phase 2 adds typing, cloze and listening_type. */
export type Mode = 'flashcard' | 'multiple_choice' | 'listening_select' | 'matching'

export type Direction = 'en_to_l1' | 'l1_to_en'

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const
export type CefrLevel = (typeof CEFR_LEVELS)[number]

export function levelIndex(level: CefrLevel): number {
  return CEFR_LEVELS.indexOf(level)
}

/** A learner's per-word flag (spec §7.4). */
export type WordFlag = 'known' | 'suspended'

/** One sense of a headword, as `core` sees it, for one L1 (spec §5.2). */
export interface CorpusEntry {
  /** Stable ID, without the `c:` prefix. */
  readonly entryId: string
  readonly headword: string
  readonly pos: string
  readonly level: CefrLevel
  readonly ipa: string
  /** A back-reference to the entry's unit; the pack validator keeps it consistent with Unit.wordIds. */
  readonly unitId: string
  readonly themes: readonly string[]
  /** Primary translation first, then accepted alternates. */
  readonly translations: readonly string[]
  readonly retired: boolean
}

/** A unit of the level path (spec §7.2). */
export interface Unit {
  readonly unitId: string
  readonly level: CefrLevel
  /** Position in the path. Unique; lower comes first. */
  readonly order: number
  /** The source of truth for unit membership and order; CorpusEntry.unitId is the back-reference. */
  readonly wordIds: readonly WordId[]
}

/**
 * One answer, as the client records it (spec §6.2). Times are epoch
 * milliseconds. Server-assigned fields live on StampedReviewEvent.
 * Deliberately without a user_id: `core` always works on one learner's events.
 */
export interface ReviewEvent {
  readonly reviewId: string
  readonly wordId: WordId
  readonly mode: Mode
  /** By convention `'en_to_l1'` for listening and matching. */
  readonly direction: Direction
  readonly grade: Grade
  readonly latencyMs: number
  readonly practice: boolean
  readonly clientTs: number
  /**
   * Minutes to ADD to UTC for the learner's local time at the moment of the
   * answer (UTC+2 is `120`): the NEGATION of `Date.prototype.getTimezoneOffset()`.
   */
  readonly clientTzOffsetMin: number
  readonly deviceId: string
  readonly deviceSeq: number
  readonly schedulerVersion: string
}

export interface StampedReviewEvent extends ReviewEvent {
  readonly receivedAt: number
  /** Immutable once assigned (spec §9.2). */
  readonly effectiveTs: number
  readonly xpEligible: boolean
}
```

- [ ] **Step 2: Write the failing test**

`core/src/grading.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { gradeAnswer, SLOW_THRESHOLD_MS } from './grading'
import { Grade } from './types'

const on = { latencyGrading: true }
const off = { latencyGrading: false }

describe('gradeAnswer', () => {
  it('passes a flashcard self-rating straight through', () => {
    for (const rating of [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy]) {
      expect(gradeAnswer('flashcard', { kind: 'self_rated', rating }, on)).toBe(rating)
    }
  })

  it('grades an incorrect answer Again, however fast', () => {
    expect(gradeAnswer('multiple_choice', { kind: 'binary', correct: false, latencyMs: 900 }, on)).toBe(
      Grade.Again,
    )
  })

  it('grades a correct answer Good at the threshold and Hard above it', () => {
    const limit = SLOW_THRESHOLD_MS.multiple_choice
    expect(gradeAnswer('multiple_choice', { kind: 'binary', correct: true, latencyMs: limit }, on)).toBe(
      Grade.Good,
    )
    expect(
      gradeAnswer('multiple_choice', { kind: 'binary', correct: true, latencyMs: limit + 1 }, on),
    ).toBe(Grade.Hard)
  })

  it('ignores latency when latency grading is switched off', () => {
    expect(
      gradeAnswer('listening_select', { kind: 'binary', correct: true, latencyMs: 60_000 }, off),
    ).toBe(Grade.Good)
  })

  it('grades a typo-accepted answer Hard even when fast', () => {
    expect(
      gradeAnswer('multiple_choice', { kind: 'binary', correct: true, latencyMs: 500, typo: true }, off),
    ).toBe(Grade.Hard)
  })

  it('never produces Easy from a binary mode', () => {
    for (const mode of ['multiple_choice', 'listening_select', 'matching'] as const) {
      for (const latencyMs of [1, 500, 5_000, 50_000]) {
        for (const correct of [true, false]) {
          expect(gradeAnswer(mode, { kind: 'binary', correct, latencyMs }, on)).not.toBe(Grade.Easy)
        }
      }
    }
  })

  it('never grades matching Hard for slowness', () => {
    expect(gradeAnswer('matching', { kind: 'binary', correct: true, latencyMs: 120_000 }, on)).toBe(
      Grade.Good,
    )
  })

  it('rejects a self-rating from a binary mode and a binary outcome from a flashcard', () => {
    expect(() => gradeAnswer('multiple_choice', { kind: 'self_rated', rating: Grade.Easy }, on)).toThrow()
    expect(() => gradeAnswer('flashcard', { kind: 'binary', correct: true, latencyMs: 1 }, on)).toThrow()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './grading'`.

- [ ] **Step 4: Implement**

`core/src/grading.ts`:

```ts
import { Grade, type Mode } from './types'

/** What a game mode reports about one answer (spec §7.3). */
export type AnswerOutcome =
  | { readonly kind: 'self_rated'; readonly rating: Grade }
  | {
      readonly kind: 'binary'
      readonly correct: boolean
      readonly latencyMs: number
      /** Accepted with a distance-1 typo. Phase 2 typing modes only. */
      readonly typo?: boolean
    }

export interface GradingOptions {
  /** Off for learners who need more time (spec §11.1). */
  readonly latencyGrading: boolean
}

/**
 * A correct answer slower than this grades Hard. Tuning values (spec §15).
 * Flashcards are self-rated and matching is a game, so neither has one.
 */
export const SLOW_THRESHOLD_MS: Readonly<Record<Mode, number>> = {
  flashcard: Number.POSITIVE_INFINITY,
  multiple_choice: 8_000,
  listening_select: 8_000,
  matching: Number.POSITIVE_INFINITY,
}

export function gradeAnswer(mode: Mode, outcome: AnswerOutcome, options: GradingOptions): Grade {
  if (outcome.kind === 'self_rated') {
    if (mode !== 'flashcard') throw new Error(`Mode ${mode} cannot be self-rated`)
    return outcome.rating
  }
  if (mode === 'flashcard') throw new Error('Flashcards are self-rated')
  if (!outcome.correct) return Grade.Again
  if (outcome.typo === true) return Grade.Hard
  if (options.latencyGrading && outcome.latencyMs > SLOW_THRESHOLD_MS[mode]) return Grade.Hard
  return Grade.Good
}
```

Append to `core/src/index.ts`:

```ts
export * from './types'
export * from './grading'
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 11 tests pass; `tsc` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add core/src
git commit -m "feat(core): shared types and grade mapping"
```

---

### Task 3: Scheduler

**Files:**
- Create: `core/src/scheduler.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/scheduler.test.ts`

**Interfaces:**
- Consumes: `Grade` (Task 2), `WordId` (Task 1).
- Produces: `SCHEDULER_VERSION: string`; `DAY_MS`; `RELEARN_DELAY_MS`; `MAX_INTERVAL_DAYS`; `RETENTION_TARGETS = { relaxed: 0.85, standard: 0.9, intensive: 0.94 }`; `RetentionSetting`; `localDay(ts: number, tzOffsetMin: number): number`; `ReviewState { wordId, stability, difficulty, introducedTs, lastReviewTs, lastReviewDay, lastGrade, reps, lapses }`; `applyGrade(prev: ReviewState | null, wordId: WordId, grade: Grade, ts: number, tzOffsetMin: number): ReviewState`; `intervalDays(stability: number, retention: number): number`; `dueDay(state: ReviewState, retention: number): number`; `isDue(state: ReviewState, retention: number, now: number, today: number): boolean`; `retrievability(state: ReviewState, now: number): number`.

Design notes for the implementer:

- `ReviewState` stores no due date. The due date is computed from stability and the learner's retention setting, which is why changing the setting reschedules at once and needs no replay (spec §7.1).
- Use `FSRSAlgorithm` from ts-fsrs directly — `next_state`, `calculate_interval_modifier`, `forgetting_curve`. Do not use the higher-level `fsrs().repeat()` API: it owns due dates and learning steps, which here are ours.
- Elapsed time is the difference of **local calendar days**, computed from each event's own time-zone offset. A word studied at 20:30 is due the next day from midnight, not from 20:30; a review the next morning is one elapsed day, not zero. (An earlier draft used 24-hour instants and whole days of the millisecond difference: it served more than half of all reviews a day late.)
- `isDue` is the only notion of due. An *Again* is due by the clock, ten minutes later; everything else is due by the day.
- The last test pins exact numbers along a path that crosses every rule: a first review, a later-day success, a lapse, a same-day *Again*, a same-day *Good*, and the interval table. It fails if `enable_short_term` is flipped. If it ever fails after a dependency or rule change, that is the signal to bump `SCHEDULER_VERSION`, not to edit the numbers quietly.

- [ ] **Step 1: Write the failing test**

`core/src/scheduler.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  applyGrade,
  DAY_MS,
  dueDay,
  intervalDays,
  isDue,
  localDay,
  RELEARN_DELAY_MS,
  RETENTION_TARGETS,
  retrievability,
  SCHEDULER_VERSION,
  type ReviewState,
} from './scheduler'
import { Grade } from './types'
import { corpusWordId } from './wordId'

const word = corpusWordId('en-000001')
/** Sofia winter time: minutes to ADD to UTC. */
const TZ = 120
/** The instant at which the learner's local wall clock reads day 5+`day` of January 2026, `hour`:`minute`. */
const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 0, 5 + day, hour, minute) - TZ * 60_000
const T0 = at(0, 11)
const { relaxed, standard, intensive } = RETENTION_TARGETS

describe('localDay', () => {
  it('is the learner’s calendar day, so the same instant can fall on different days', () => {
    const ts = Date.UTC(2026, 0, 5, 23, 0)
    expect(localDay(ts, 120)).toBe(localDay(ts, 0) + 1)
    expect(localDay(ts, -300)).toBe(localDay(ts, 0))
  })

  it('advances at the local midnight, not at 24-hour boundaries', () => {
    expect(localDay(at(0, 23, 59), TZ)).toBe(localDay(at(0, 0, 0), TZ))
    expect(localDay(at(1, 0, 0), TZ)).toBe(localDay(at(0, 0, 0), TZ) + 1)
  })
})

describe('applyGrade', () => {
  it('creates state on the first review', () => {
    const s = applyGrade(null, word, Grade.Good, T0, TZ)
    expect(s).toMatchObject({
      wordId: word,
      introducedTs: T0,
      lastReviewTs: T0,
      lastReviewDay: localDay(T0, TZ),
      reps: 1,
      lapses: 0,
    })
    expect(s.stability).toBeGreaterThan(0)
    expect(s.difficulty).toBeGreaterThanOrEqual(1)
    expect(s.difficulty).toBeLessThanOrEqual(10)
  })

  it('gives a first Easy more stability than Good, Good more than Hard, Hard more than Again', () => {
    const by = (g: Grade) => applyGrade(null, word, g, T0, TZ).stability
    expect(by(Grade.Easy)).toBeGreaterThan(by(Grade.Good))
    expect(by(Grade.Good)).toBeGreaterThan(by(Grade.Hard))
    expect(by(Grade.Hard)).toBeGreaterThan(by(Grade.Again))
  })

  it('grows stability on a successful later-day review and keeps introducedTs', () => {
    const first = applyGrade(null, word, Grade.Good, T0, TZ)
    const second = applyGrade(first, word, Grade.Good, T0 + 3 * DAY_MS, TZ)
    expect(second.stability).toBeGreaterThan(first.stability)
    expect(second.introducedTs).toBe(T0)
    expect(second.reps).toBe(2)
  })

  it('counts elapsed time in local days: a next-morning review is one day, not zero', () => {
    const first = applyGrade(null, word, Grade.Good, at(0, 21), TZ)
    const nextMorning = applyGrade(first, word, Grade.Good, at(1, 8), TZ) // 11 hours later
    const fullDay = applyGrade(first, word, Grade.Good, at(0, 21) + DAY_MS, TZ)
    const sameDay = applyGrade(first, word, Grade.Good, at(0, 21), TZ)
    expect(nextMorning.stability).toBeCloseTo(fullDay.stability, 10)
    expect(nextMorning.stability).toBeGreaterThan(sameDay.stability)
  })

  it('counts a lapse only when the word leaves a passed state', () => {
    expect(applyGrade(null, word, Grade.Again, T0, TZ).lapses).toBe(0)
    const first = applyGrade(null, word, Grade.Good, T0, TZ)
    const lapsed = applyGrade(first, word, Grade.Again, T0 + 5 * DAY_MS, TZ)
    expect(lapsed.lapses).toBe(1)
    expect(lapsed.stability).toBeLessThan(first.stability)
  })

  it('counts consecutive Agains once, but Again → Good → Again twice', () => {
    const first = applyGrade(null, word, Grade.Good, T0, TZ)
    const again = applyGrade(first, word, Grade.Again, T0 + 5 * DAY_MS, TZ)
    const againAgain = applyGrade(again, word, Grade.Again, T0 + 5 * DAY_MS, TZ)
    expect(againAgain.lapses).toBe(1)
    const recovered = applyGrade(againAgain, word, Grade.Good, T0 + 5 * DAY_MS, TZ)
    expect(applyGrade(recovered, word, Grade.Again, T0 + 9 * DAY_MS, TZ).lapses).toBe(2)
  })

  it('treats a timestamp before the previous review as zero elapsed time', () => {
    const first = applyGrade(null, word, Grade.Good, T0, TZ)
    expect(() => applyGrade(first, word, Grade.Good, T0 - DAY_MS, TZ)).not.toThrow()
  })

  it('is deterministic', () => {
    const run = () =>
      applyGrade(applyGrade(null, word, Grade.Good, T0, TZ), word, Grade.Hard, T0 + 2 * DAY_MS, TZ)
    expect(run()).toEqual(run())
  })
})

describe('dueDay, isDue and desired retention', () => {
  const state = applyGrade(applyGrade(null, word, Grade.Good, T0, TZ), word, Grade.Good, T0 + 3 * DAY_MS, TZ)

  it('schedules standard retention at about the stability, in whole days', () => {
    expect(intervalDays(10, standard)).toBe(10)
    expect(dueDay(state, standard)).toBe(state.lastReviewDay + intervalDays(state.stability, standard))
  })

  it('orders the three settings: intensive soonest, relaxed latest', () => {
    expect(dueDay(state, intensive)).toBeLessThan(dueDay(state, standard))
    expect(dueDay(state, standard)).toBeLessThan(dueDay(state, relaxed))
  })

  it('never schedules a passed word less than a day out', () => {
    expect(intervalDays(0.2, intensive)).toBe(1)
  })

  it('serves a one-day word on the next local day, however early on it the learner studies', () => {
    const evening = at(0, 20, 30)
    const day = localDay(evening, TZ)
    const state1: ReviewState = { ...applyGrade(null, word, Grade.Good, evening, TZ), stability: 1 }
    expect(intervalDays(state1.stability, standard)).toBe(1)
    expect(isDue(state1, standard, evening, day)).toBe(false)
    expect(isDue(state1, standard, at(0, 23, 59), day)).toBe(false)
    // 30 minutes "early" by the clock, but a new calendar day.
    expect(isDue(state1, standard, at(1, 8), day + 1)).toBe(true)
    expect(isDue(state1, standard, at(1, 20), day + 1)).toBe(true)
  })

  it('brings an Again back the same day, after the relearn delay', () => {
    const ts = T0 + 20 * DAY_MS
    const day = localDay(ts, TZ)
    const lapsed = applyGrade(state, word, Grade.Again, ts, TZ)
    expect(isDue(lapsed, standard, ts + RELEARN_DELAY_MS - 1, day)).toBe(false)
    expect(isDue(lapsed, standard, ts + RELEARN_DELAY_MS, day)).toBe(true)
  })
})

describe('retrievability', () => {
  it('is 1 at the moment of review, ~0.9 at the stability, and falls over time', () => {
    const s = applyGrade(null, word, Grade.Good, T0, TZ)
    expect(retrievability(s, T0)).toBeCloseTo(1, 6)
    expect(retrievability(s, T0 + s.stability * DAY_MS)).toBeCloseTo(0.9, 2)
    expect(retrievability(s, T0 + 30 * DAY_MS)).toBeLessThan(retrievability(s, T0 + 10 * DAY_MS))
  })
})

describe('SCHEDULER_VERSION', () => {
  /**
   * Every branch of the rules on one path: a first review, a later-day success,
   * a lapse, a same-day relearn, a same-day recovery and a later-day success.
   * These numbers are facts about ts-fsrs 5.4.2 with our parameters. If this
   * test fails, the rules changed: bump SCHEDULER_VERSION (and re-derive), do
   * NOT edit the numbers to match.
   */
  it('pins the state the current rules derive; a failure means bump SCHEDULER_VERSION', () => {
    expect(SCHEDULER_VERSION).toBe('fsrs6-tsfsrs5.4.2-r2')

    // Each step's offset is from the step before it, in local days.
    const s1 = applyGrade(null, word, Grade.Good, at(0, 10), TZ) // first review
    expect(s1.stability).toBeCloseTo(2.3065, 6)
    expect(s1.difficulty).toBeCloseTo(2.11810397, 6)

    const s2 = applyGrade(s1, word, Grade.Good, at(2, 10), TZ) // +2 days
    expect(s2.stability).toBeCloseTo(10.96433194, 6)
    expect(s2.difficulty).toBeCloseTo(2.11121424, 6)

    const s3 = applyGrade(s2, word, Grade.Again, at(7, 10), TZ) // +5 days: a lapse
    expect(s3.stability).toBeCloseTo(1.42875311, 6)
    expect(s3.difficulty).toBeCloseTo(7.39223814, 6)

    const s4 = applyGrade(s3, word, Grade.Again, at(7, 10), TZ) // same day: short-term
    expect(s4.stability).toBeCloseTo(0.49549428, 6)
    expect(s4.difficulty).toBeCloseTo(9.12807478, 6)

    const s5 = applyGrade(s4, word, Grade.Good, at(7, 10), TZ) // same day: relearned
    expect(s5.stability).toBeCloseTo(0.54524571, 6)
    expect(s5.difficulty).toBeCloseTo(9.11417507, 6)

    const s6 = applyGrade(s5, word, Grade.Good, at(10, 10), TZ) // +3 days
    expect(s6.stability).toBeCloseTo(2.16541104, 6)
    expect(s6.difficulty).toBeCloseTo(9.10028926, 6)

    expect(s6.reps).toBe(6)
    expect(s6.lapses).toBe(1)

    expect(intervalDays(10, relaxed)).toBe(19)
    expect(intervalDays(10, standard)).toBe(10)
    expect(intervalDays(10, intensive)).toBe(5)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './scheduler'`.

- [ ] **Step 3: Implement**

`core/src/scheduler.ts`:

```ts
import { FSRSAlgorithm, generatorParameters } from 'ts-fsrs'
import { Grade } from './types'
import type { WordId } from './wordId'

/**
 * Identifies the FSRS library, its parameter set and our scheduling rules.
 * Any change to a rule or parameter in this file is a version bump (spec §4.3).
 */
export const SCHEDULER_VERSION = 'fsrs6-tsfsrs5.4.2-r2'

export const DAY_MS = 86_400_000

/** A word rated Again comes back the same day, after this long. */
export const RELEARN_DELAY_MS = 10 * 60 * 1000

export const MAX_INTERVAL_DAYS = 36_500

/** The learner-facing desired-retention setting (spec §7.1). Tuning values (§15). */
export const RETENTION_TARGETS = { relaxed: 0.85, standard: 0.9, intensive: 0.94 } as const
export type RetentionSetting = keyof typeof RETENTION_TARGETS

/**
 * The learner's local calendar day as an integer, days since the epoch
 * (spec §8.4: a day is the local date at the moment of the answer).
 * `tzOffsetMin` is minutes to ADD to UTC, as on ReviewEvent.clientTzOffsetMin.
 */
export function localDay(ts: number, tzOffsetMin: number): number {
  return Math.floor((ts + tzOffsetMin * 60_000) / DAY_MS)
}

/** FSRS memory state for one word. Derived from events, never edited. */
export interface ReviewState {
  readonly wordId: WordId
  readonly stability: number
  readonly difficulty: number
  readonly introducedTs: number
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
}

// Fuzz is off so that every engine derives the same state from the same events.
const algorithm = new FSRSAlgorithm(generatorParameters({ enable_fuzz: false, enable_short_term: true }))

/**
 * Applies one scheduled answer. `prev` is null for a word's first review.
 * `tzOffsetMin` is the offset the answer was given at (ReviewEvent.clientTzOffsetMin),
 * so FSRS is told how many calendar days the learner actually let pass.
 */
export function applyGrade(
  prev: ReviewState | null,
  wordId: WordId,
  grade: Grade,
  ts: number,
  tzOffsetMin: number,
): ReviewState {
  const day = localDay(ts, tzOffsetMin)
  const memory = prev ? { stability: prev.stability, difficulty: prev.difficulty } : null
  const elapsedDays = prev ? Math.max(0, day - prev.lastReviewDay) : 0
  const next = algorithm.next_state(memory, elapsedDays, grade)
  const lapsed = prev !== null && grade === Grade.Again && prev.lastGrade !== Grade.Again
  return {
    wordId,
    stability: next.stability,
    difficulty: next.difficulty,
    introducedTs: prev ? prev.introducedTs : ts,
    lastReviewTs: ts,
    lastReviewDay: day,
    lastGrade: grade,
    reps: (prev?.reps ?? 0) + 1,
    lapses: (prev?.lapses ?? 0) + (lapsed ? 1 : 0),
  }
}

/**
 * Days until predicted recall falls to `retention`. Depends on stability
 * alone, so changing the retention setting needs no replay (spec §7.1).
 */
export function intervalDays(stability: number, retention: number): number {
  const days = Math.round(stability * algorithm.calculate_interval_modifier(retention))
  return Math.min(Math.max(days, 1), MAX_INTERVAL_DAYS)
}

/** The local calendar day a passed word comes back on. */
export function dueDay(state: ReviewState, retention: number): number {
  return state.lastReviewDay + intervalDays(state.stability, retention)
}

/**
 * Whether the word is to be served. A word rated Again is relearning and comes
 * back `RELEARN_DELAY_MS` after the answer; every other word is due on a whole
 * local day, so the home screen and a session ask the same question and get
 * the same answer (spec §8.4).
 */
export function isDue(state: ReviewState, retention: number, now: number, today: number): boolean {
  if (state.lastGrade === Grade.Again) return now >= state.lastReviewTs + RELEARN_DELAY_MS
  return today >= dueDay(state, retention)
}

/** Predicted probability of recall at `now`, in [0, 1]. */
export function retrievability(state: ReviewState, now: number): number {
  const days = Math.max(0, (now - state.lastReviewTs) / DAY_MS)
  return algorithm.forgetting_curve(days, state.stability)
}
```

Append to `core/src/index.ts`:

```ts
export * from './scheduler'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 28 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): FSRS scheduler with desired retention"
```

---

### Task 4: Event replay

**Files:**
- Create: `core/src/replay.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/replay.test.ts`

**Interfaces:**
- Consumes: `applyGrade`, `ReviewState`, `DAY_MS` (Task 3); `StampedReviewEvent`, `Grade` (Task 2); `WordId` (Task 1).
- Produces: `ReplayEvent` (the `reviewId`, `wordId`, `mode`, `grade`, `practice`, `effectiveTs`, `clientTzOffsetMin`, `deviceId`, `deviceSeq` fields of `StampedReviewEvent`); `AliasMap = ReadonlyMap<WordId, WordId>`; `resolveAlias(wordId: WordId, aliases: AliasMap): WordId`; `compareEvents(a: ReplayEvent, b: ReplayEvent): number`; `replay(events: Iterable<ReplayEvent>, aliases?: AliasMap): Map<WordId, ReviewState>`.

Replay skips an event when it is practice **or** its mode is `matching` — the engine, not the client, guarantees that matching never moves the schedule (spec §8.1). Events are sorted before they are deduplicated, so even two different payloads under one `reviewId` resolve the same way in any input order.

The same function runs on the server (authoritative) and on clients (provisional). A client replaying events it has not pushed yet uses each event's `clientTs` as its `effectiveTs`.

- [ ] **Step 1: Write the failing test**

The two property tests at the end are the ones the spec asks for (§13): replay must converge regardless of order or duplication. `core/src/replay.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './replay'`.

- [ ] **Step 3: Implement**

`core/src/replay.ts`:

```ts
import { applyGrade, type ReviewState } from './scheduler'
import type { StampedReviewEvent } from './types'
import type { WordId } from './wordId'

/** The fields of an event that replay reads. A StampedReviewEvent satisfies it. */
export type ReplayEvent = Pick<
  StampedReviewEvent,
  | 'reviewId'
  | 'wordId'
  | 'mode'
  | 'grade'
  | 'practice'
  | 'effectiveTs'
  | 'clientTzOffsetMin'
  | 'deviceId'
  | 'deviceSeq'
>

/** user word → corpus entry merges (spec §6.1). Events are never rewritten. */
export type AliasMap = ReadonlyMap<WordId, WordId>

export function resolveAlias(wordId: WordId, aliases: AliasMap): WordId {
  let current = wordId
  const seen = new Set<WordId>([current])
  for (let next = aliases.get(current); next !== undefined; next = aliases.get(current)) {
    if (seen.has(next)) throw new Error(`Alias cycle at ${next}`)
    seen.add(next)
    current = next
  }
  return current
}

/** The total, deterministic replay order (spec §9.2). */
export function compareEvents(a: ReplayEvent, b: ReplayEvent): number {
  if (a.effectiveTs !== b.effectiveTs) return a.effectiveTs - b.effectiveTs
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1
  if (a.deviceSeq !== b.deviceSeq) return a.deviceSeq - b.deviceSeq
  return a.reviewId < b.reviewId ? -1 : a.reviewId > b.reviewId ? 1 : 0
}

/**
 * An event that never moves the schedule: practice, and every matching answer,
 * whatever the client flagged it as. The engine is what makes the rule true
 * (spec §8.1, §13) — the server accepts any well-formed event.
 */
function isScheduled(event: ReplayEvent): boolean {
  return !event.practice && event.mode !== 'matching'
}

/**
 * Derives review state from the event log. The result depends only on the
 * set of events: not on their order, and not on duplicates. Practice and
 * matching events are skipped (spec §7.4, §8.1).
 */
export function replay(
  events: Iterable<ReplayEvent>,
  aliases: AliasMap = new Map(),
): Map<WordId, ReviewState> {
  // Ordering before deduplication keeps the choice between two payloads that
  // collide on one reviewId a function of the events, not of their arrival.
  const ordered = [...events].filter(isScheduled).sort(compareEvents)
  const unique = new Map<string, ReplayEvent>()
  for (const event of ordered) {
    if (!unique.has(event.reviewId)) unique.set(event.reviewId, event)
  }
  const states = new Map<WordId, ReviewState>()
  for (const event of unique.values()) {
    const wordId = resolveAlias(event.wordId, aliases)
    const prev = states.get(wordId) ?? null
    states.set(wordId, applyGrade(prev, wordId, event.grade, event.effectiveTs, event.clientTzOffsetMin))
  }
  return states
}
```

Append to `core/src/index.ts`:

```ts
export * from './replay'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 42 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): order-independent event replay with aliases"
```

---

### Task 5: Mastery tiers

**Files:**
- Create: `core/src/mastery.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/mastery.test.ts`

**Interfaces:**
- Consumes: `ReviewState`, `applyGrade`, `DAY_MS` (Task 3).
- Produces: `MasteryTier = 'new' | 'learning' | 'young' | 'mature'`; `TIER_MIN_STABILITY_DAYS = { young: 4, mature: 21 }`; `masteryTier(state: ReviewState | null | undefined): MasteryTier`.

A word the learner has flagged *known* is not a tier: the flag lives outside review state, and the caller shows it as known-by-declaration instead of calling this function (spec §7.4).

- [ ] **Step 1: Write the failing test**

`core/src/mastery.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { masteryTier, TIER_MIN_STABILITY_DAYS } from './mastery'
import { applyGrade, DAY_MS, type ReviewState } from './scheduler'
import { Grade } from './types'
import { corpusWordId } from './wordId'

const word = corpusWordId('en-000001')
/** Sofia winter time: minutes to ADD to UTC. */
const TZ = 120
const T0 = Date.UTC(2026, 0, 5)
const withStability = (stability: number): ReviewState => ({ ...applyGrade(null, word, Grade.Good, T0, TZ), stability })

describe('masteryTier', () => {
  it('is new until the word has state', () => {
    expect(masteryTier(null)).toBe('new')
    expect(masteryTier(undefined)).toBe('new')
  })

  it('switches tier exactly at the thresholds', () => {
    expect(masteryTier(withStability(TIER_MIN_STABILITY_DAYS.young - 0.01))).toBe('learning')
    expect(masteryTier(withStability(TIER_MIN_STABILITY_DAYS.young))).toBe('young')
    expect(masteryTier(withStability(TIER_MIN_STABILITY_DAYS.mature - 0.01))).toBe('young')
    expect(masteryTier(withStability(TIER_MIN_STABILITY_DAYS.mature))).toBe('mature')
  })

  it('walks a typical word from learning to young to mature', () => {
    let s = applyGrade(null, word, Grade.Good, T0, TZ)
    expect(masteryTier(s)).toBe('learning')
    s = applyGrade(s, word, Grade.Good, T0 + 2 * DAY_MS, TZ)
    expect(masteryTier(s)).toBe('young')
    s = applyGrade(s, word, Grade.Good, T0 + 13 * DAY_MS, TZ)
    expect(masteryTier(s)).toBe('mature')
  })

  it('drops a lapsed word back to learning', () => {
    let s = applyGrade(null, word, Grade.Easy, T0, TZ)
    s = applyGrade(s, word, Grade.Good, T0 + 8 * DAY_MS, TZ)
    s = applyGrade(s, word, Grade.Again, T0 + 40 * DAY_MS, TZ)
    expect(masteryTier(s)).toBe('learning')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './mastery'`.

- [ ] **Step 3: Implement**

`core/src/mastery.ts`:

```ts
import type { ReviewState } from './scheduler'

/** Progress tiers shown to the learner (spec §8.3). */
export type MasteryTier = 'new' | 'learning' | 'young' | 'mature'

/**
 * Stability, in days, at which a word enters a tier. Presentational:
 * changing these re-labels existing state and needs no re-derivation (§4.3).
 */
export const TIER_MIN_STABILITY_DAYS = { young: 4, mature: 21 } as const

/**
 * The tier for one word's memory state. It cannot see flags: a word flagged
 * known is shown as known-by-declaration and must be excluded by the caller
 * before mature words are counted (spec §7.4).
 */
export function masteryTier(state: ReviewState | null | undefined): MasteryTier {
  if (!state) return 'new'
  if (state.stability >= TIER_MIN_STABILITY_DAYS.mature) return 'mature'
  if (state.stability >= TIER_MIN_STABILITY_DAYS.young) return 'young'
  return 'learning'
}
```

Append to `core/src/index.ts`:

```ts
export * from './mastery'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 46 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): mastery tiers from stability"
```

---

### Task 6: Randomness and mode selection

**Files:**
- Create: `core/src/rng.ts`, `core/src/modeSelection.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/rng.test.ts`, `core/src/modeSelection.test.ts`

**Interfaces:**
- Consumes: `MasteryTier` (Task 5); `Mode` (Task 2).
- Produces, from `rng.ts`: `type Rng = () => number` (a float in [0, 1)); `seededRng(seed: number): Rng`; `shuffle<T>(items: readonly T[], rng: Rng): T[]`.
- Produces, from `modeSelection.ts`: `RECOGNITION_MODES`; `RECALL_MODES`; `chooseMode(tier: MasteryTier, available: ReadonlySet<Mode>, rng: Rng): Mode`.

The caller decides what is `available`: it leaves `listening_select` out when the clip is not cached and the device is offline (spec §9.3), or when the learner has audio turned off (spec §11.1).

- [ ] **Step 1: Write the failing tests**

`core/src/rng.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { seededRng, shuffle } from './rng'

describe('seededRng', () => {
  it('repeats for the same seed and differs across seeds', () => {
    const take = (seed: number) => Array.from({ length: 5 }, seededRng(seed))
    expect(take(42)).toEqual(take(42))
    expect(take(42)).not.toEqual(take(43))
  })

  it('stays inside [0, 1)', () => {
    const rng = seededRng(7)
    for (let i = 0; i < 10_000; i += 1) {
      const x = rng()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('shuffle', () => {
  it('permutes without mutating its input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8]
    const out = shuffle(input, seededRng(1))
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([...out].sort((a, b) => a - b)).toEqual(input)
    expect(out).not.toEqual(input)
  })
})
```

`core/src/modeSelection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { MasteryTier } from './mastery'
import { chooseMode } from './modeSelection'
import { seededRng } from './rng'
import type { Mode } from './types'

const ALL = new Set<Mode>(['flashcard', 'multiple_choice', 'listening_select', 'matching'])
const NO_AUDIO = new Set<Mode>(['flashcard', 'multiple_choice', 'matching'])

function picks(tier: MasteryTier, available: ReadonlySet<Mode>): Set<Mode> {
  const rng = seededRng(99)
  return new Set(Array.from({ length: 200 }, () => chooseMode(tier, available, rng)))
}

describe('chooseMode', () => {
  it('uses recognition modes while a word is new or learning', () => {
    expect(picks('new', ALL)).toEqual(new Set(['multiple_choice', 'listening_select']))
    expect(picks('learning', ALL)).toEqual(new Set(['multiple_choice', 'listening_select']))
  })

  it('escalates to recall once a word is young or mature', () => {
    expect(picks('young', ALL)).toEqual(new Set(['flashcard']))
    expect(picks('mature', ALL)).toEqual(new Set(['flashcard']))
  })

  it('never picks listening when audio is unavailable', () => {
    for (const tier of ['new', 'learning', 'young', 'mature'] as const) {
      expect(picks(tier, NO_AUDIO).has('listening_select')).toBe(false)
    }
  })

  it('never picks matching', () => {
    for (const tier of ['new', 'learning', 'young', 'mature'] as const) {
      expect(picks(tier, ALL).has('matching')).toBe(false)
    }
  })

  it('falls back to the other group rather than failing', () => {
    expect(chooseMode('new', new Set<Mode>(['flashcard']), seededRng(1))).toBe('flashcard')
    expect(chooseMode('mature', new Set<Mode>(['multiple_choice']), seededRng(1))).toBe('multiple_choice')
  })

  it('throws when nothing schedulable is available', () => {
    expect(() => chooseMode('new', new Set<Mode>(['matching']), seededRng(1))).toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './rng'` and `Cannot find module './modeSelection'`.

- [ ] **Step 3: Implement**

`core/src/rng.ts`:

```ts
/** `core` does no I/O, so randomness is always passed in. Returns a float in [0, 1). */
export type Rng = () => number

/** A small seeded generator (mulberry32), for reproducible sessions and tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Fisher–Yates. Returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}
```

`core/src/modeSelection.ts`:

```ts
import type { MasteryTier } from './mastery'
import type { Rng } from './rng'
import type { Mode } from './types'

/** Modes that offer options to choose from (spec §7.5). */
export const RECOGNITION_MODES: readonly Mode[] = ['multiple_choice', 'listening_select']

/** Modes with nothing to choose from. Phase 2 adds typing, cloze and listening_type. */
export const RECALL_MODES: readonly Mode[] = ['flashcard']

/**
 * Picks the mode for one item of a mixed session: recognition while the word
 * is new or learning, recall once it is young or better. `available` is what
 * can run right now — the caller leaves out listening_select when the clip is
 * not cached and the device is offline, or when the learner has audio off.
 * Matching is a practice game and is never picked.
 */
export function chooseMode(tier: MasteryTier, available: ReadonlySet<Mode>, rng: Rng): Mode {
  const wantsRecall = tier === 'young' || tier === 'mature'
  const [preferred, fallback] = wantsRecall
    ? [RECALL_MODES, RECOGNITION_MODES]
    : [RECOGNITION_MODES, RECALL_MODES]
  for (const group of [preferred, fallback]) {
    const usable = group.filter((mode) => available.has(mode))
    if (usable.length > 0) return usable[Math.floor(rng() * usable.length)]!
  }
  throw new Error('No schedulable game mode is available')
}
```

Append to `core/src/index.ts`:

```ts
export * from './rng'
export * from './modeSelection'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 55 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): injectable rng and mode escalation"
```

---

### Task 7: Level path

**Files:**
- Create: `core/src/path.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/path.test.ts`

**Interfaces:**
- Consumes: `Unit`, `CefrLevel`, `WordFlag`, `levelIndex` (Task 2); `WordId` (Task 1).
- Produces: `PathContext { units, retired, flags, introduced, declaredLevel, unlocked }`; `isLive(wordId, ctx): boolean`; `assumedKnownWords(ctx): Set<WordId>`; `computeUnlocks(ctx): string[]` (unit IDs to **add**); `currentUnit(ctx): Unit | null`; `pathNewWords(ctx, limit: number): WordId[]`.

`currentUnit` and `pathNewWords` apply the unlock rule themselves, over `ctx.unlocked` plus whatever `computeUnlocks` would add, so the queue cannot come back empty merely because the caller has not yet persisted an unlock. `ctx.unlocked` is the persisted set; callers still store what `computeUnlocks` returns. `introduced` means "has at least one non-practice review" — in practice, the keys of the map `replay` returns.

- [ ] **Step 1: Write the failing test**

The final property test is the spec's requirement that the new-word queue is never empty while live words remain (§13). `core/src/path.test.ts`:

```ts
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { assumedKnownWords, computeUnlocks, currentUnit, pathNewWords, type PathContext } from './path'
import type { CefrLevel, Unit, WordFlag } from './types'
import { corpusWordId, type WordId } from './wordId'

const w = (n: number) => corpusWordId(`en-${String(n).padStart(6, '0')}`)
const unit = (unitId: string, level: CefrLevel, order: number, ids: number[]): Unit => ({
  unitId,
  level,
  order,
  wordIds: ids.map(w),
})

const UNITS = [
  unit('a1-u1', 'A1', 1, [1, 2, 3]),
  unit('a1-u2', 'A1', 2, [4, 5, 6]),
  unit('a2-u1', 'A2', 3, [7, 8, 9]),
  unit('a2-u2', 'A2', 4, [10, 11, 12]),
]

function ctx(over: Partial<PathContext> = {}): PathContext {
  return {
    units: UNITS,
    retired: new Set(),
    flags: new Map(),
    introduced: new Set(),
    declaredLevel: 'A1',
    unlocked: new Set(),
    ...over,
  }
}

describe('computeUnlocks', () => {
  it('unlocks the first unit for a new A1 learner', () => {
    expect(computeUnlocks(ctx())).toEqual(['a1-u1'])
  })

  it('unlocks the successor once every word of the unit is introduced', () => {
    const base = { unlocked: new Set(['a1-u1']) }
    expect(computeUnlocks(ctx({ ...base, introduced: new Set([w(1), w(2)]) }))).toEqual([])
    expect(computeUnlocks(ctx({ ...base, introduced: new Set([w(1), w(2), w(3)]) }))).toEqual(['a1-u2'])
  })

  it('does not wait for retired, known or suspended words', () => {
    const c = ctx({
      unlocked: new Set(['a1-u1']),
      introduced: new Set([w(1)]),
      retired: new Set([w(2)]),
      flags: new Map<WordId, WordFlag>([[w(3), 'suspended']]),
    })
    expect(computeUnlocks(c)).toEqual(['a1-u2'])
  })

  it('chains through a unit with no live words left', () => {
    const c = ctx({
      unlocked: new Set(['a1-u1']),
      introduced: new Set([w(1), w(2), w(3)]),
      flags: new Map<WordId, WordFlag>([[w(4), 'known'], [w(5), 'known'], [w(6), 'known']]),
    })
    expect(computeUnlocks(c)).toEqual(['a1-u2', 'a2-u1'])
  })

  it('unlocks everything below the declared level, plus the first unit at it', () => {
    expect(computeUnlocks(ctx({ declaredLevel: 'A2' }))).toEqual(['a1-u1', 'a1-u2', 'a2-u1'])
  })

  it('counts a word pulled forward by a collection toward its unit', () => {
    const c = ctx({ unlocked: new Set(['a1-u1']), introduced: new Set([w(1), w(2), w(3), w(4), w(5), w(6)]) })
    expect(computeUnlocks(c)).toEqual(['a1-u2', 'a2-u1'])
  })

  it('never proposes removing an unlock', () => {
    const c = ctx({ declaredLevel: 'A1', unlocked: new Set(['a1-u1', 'a1-u2', 'a2-u1']) })
    expect(computeUnlocks(c)).toEqual([])
  })
})

describe('currentUnit and pathNewWords', () => {
  it('sees the unlocks the context implies, without the caller persisting them first', () => {
    const c = ctx({ unlocked: new Set(['a1-u1']), introduced: new Set([w(1), w(2), w(3)]) })
    expect(computeUnlocks(c)).toEqual(['a1-u2'])
    expect(currentUnit(c)?.unitId).toBe('a1-u2')
    expect(pathNewWords(c, 3)).toEqual([w(4), w(5), w(6)])
  })

  it('serves a brand-new learner whose unlock set is still empty', () => {
    const c = ctx({ unlocked: new Set() })
    expect(currentUnit(c)?.unitId).toBe('a1-u1')
    expect(pathNewWords(c, 2)).toEqual([w(1), w(2)])
  })

  it('skips assumed-known units', () => {
    const c = ctx({ declaredLevel: 'A2', unlocked: new Set(['a1-u1', 'a1-u2', 'a2-u1']) })
    expect(currentUnit(c)?.unitId).toBe('a2-u1')
    expect(pathNewWords(c, 10).slice(0, 3)).toEqual([w(7), w(8), w(9)])
    expect(assumedKnownWords(c)).toEqual(new Set([w(1), w(2), w(3), w(4), w(5), w(6)]))
  })

  it('returns never-introduced words to the queue when the level is lowered', () => {
    const c = ctx({
      declaredLevel: 'A1',
      unlocked: new Set(['a1-u1', 'a1-u2', 'a2-u1']),
      introduced: new Set([w(7)]),
    })
    expect(currentUnit(c)?.unitId).toBe('a1-u1')
    expect(assumedKnownWords(c).size).toBe(0)
  })

  it('runs on into the next unit, so a session is not cut short at a unit boundary', () => {
    const c = ctx({ unlocked: new Set(['a1-u1']), introduced: new Set([w(1), w(2)]) })
    expect(pathNewWords(c, 3)).toEqual([w(3), w(4), w(5)])
  })

  it('drains each unit before starting the next, so every offered word is unlocked by the time it is reached', () => {
    const c = ctx({ unlocked: new Set(['a1-u1']), introduced: new Set([w(1), w(2)]), retired: new Set([w(5)]) })
    const offered = pathNewWords(c, 100)
    expect(offered).toEqual([w(3), w(4), w(6), w(7), w(8), w(9), w(10), w(11), w(12)])
    // Introduce the words in the order offered: the unlock rule has always opened a word's unit first.
    const unlocked = new Set(c.unlocked)
    const introduced = new Set(c.introduced)
    for (const id of offered) {
      for (const unitId of computeUnlocks({ ...c, unlocked, introduced })) unlocked.add(unitId)
      const home = UNITS.find((u) => u.wordIds.includes(id))
      expect(home && unlocked.has(home.unitId)).toBe(true)
      introduced.add(id)
    }
  })

  it('respects the limit and skips words that are not live', () => {
    const c = ctx({ unlocked: new Set(['a1-u1']), retired: new Set([w(2)]) })
    expect(pathNewWords(c, 2)).toEqual([w(1), w(3)])
    expect(pathNewWords(c, 0)).toEqual([])
  })

  it('is empty when the path is finished', () => {
    const c = ctx({
      unlocked: new Set(UNITS.map((u) => u.unitId)),
      introduced: new Set(UNITS.flatMap((u) => u.wordIds)),
    })
    expect(currentUnit(c)).toBeNull()
    expect(pathNewWords(c, 10)).toEqual([])
  })
})

describe('the new-word queue never runs dry (spec §13)', () => {
  const allWords = UNITS.flatMap((u) => u.wordIds)
  const subset = fc.subarray(allWords)

  it('always offers a word while any live, never-introduced word remains on the path', () => {
    fc.assert(
      fc.property(
        subset,
        subset,
        subset,
        fc.constantFrom<CefrLevel>('A1', 'A2'),
        (introduced, retired, flagged, declaredLevel) => {
          // Walk the path the way a learner does: apply unlocks, study what is offered, repeat.
          const c0 = ctx({
            declaredLevel,
            retired: new Set(retired),
            flags: new Map(flagged.map((id): [WordId, WordFlag] => [id, 'known'])),
          })
          const unlocked = new Set<string>()
          const seen = new Set<WordId>(introduced)
          for (let step = 0; step < 50; step += 1) {
            const c = { ...c0, unlocked, introduced: seen }
            for (const id of computeUnlocks(c)) unlocked.add(id)
            const next = pathNewWords({ ...c, unlocked }, 2)
            if (next.length === 0) break
            for (const id of next) seen.add(id)
          }
          const final = { ...c0, unlocked, introduced: seen }
          const left = UNITS.filter((u) => declaredLevel === 'A1' || u.level !== 'A1')
            .flatMap((u) => u.wordIds)
            .filter((id) => !final.retired.has(id) && !final.flags.has(id) && !seen.has(id))
          expect(left).toEqual([])
        },
      ),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './path'`.

- [ ] **Step 3: Implement**

`core/src/path.ts`:

```ts
import { levelIndex, type CefrLevel, type Unit, type WordFlag } from './types'
import type { WordId } from './wordId'

/** Everything the level-path rules read (spec §7.2). */
export interface PathContext {
  /** Every unit in the loaded packs, in any order. */
  readonly units: readonly Unit[]
  readonly retired: ReadonlySet<WordId>
  readonly flags: ReadonlyMap<WordId, WordFlag>
  /** Words with at least one non-practice review, wherever they came from. */
  readonly introduced: ReadonlySet<WordId>
  readonly declaredLevel: CefrLevel
  /**
   * The learner's grow-only unit_unlock set, as persisted. The queue functions
   * close over the unlocks it implies themselves, so they do not depend on the
   * caller having written `computeUnlocks` back first.
   */
  readonly unlocked: ReadonlySet<string>
}

/** Retired, known and suspended words are invisible to every progress rule. */
export function isLive(wordId: WordId, ctx: Pick<PathContext, 'retired' | 'flags'>): boolean {
  return !ctx.retired.has(wordId) && !ctx.flags.has(wordId)
}

function inPathOrder(units: readonly Unit[]): Unit[] {
  return [...units].sort((a, b) => a.order - b.order)
}

function isBelow(unit: Unit, level: CefrLevel): boolean {
  return levelIndex(unit.level) < levelIndex(level)
}

function pendingWords(unit: Unit, ctx: PathContext): WordId[] {
  return unit.wordIds.filter((id) => isLive(id, ctx) && !ctx.introduced.has(id))
}

/**
 * Never-introduced live words in units below the declared level. Not stored:
 * it follows the level when the learner changes it.
 */
export function assumedKnownWords(ctx: PathContext): Set<WordId> {
  const out = new Set<WordId>()
  for (const unit of ctx.units) {
    if (isBelow(unit, ctx.declaredLevel)) for (const id of pendingWords(unit, ctx)) out.add(id)
  }
  return out
}

/**
 * Every unit the context unlocks: the persisted set plus what the rules add to
 * it. Units below the declared level are unlocked outright; from there on, a
 * unit unlocks its successor once every live word in it has been introduced.
 */
function unlockedSet(ctx: PathContext, ordered: readonly Unit[]): Set<string> {
  const all = new Set(ctx.unlocked)
  const path: Unit[] = []
  for (const unit of ordered) {
    if (isBelow(unit, ctx.declaredLevel)) all.add(unit.unitId)
    else path.push(unit)
  }
  const first = path[0]
  if (first) all.add(first.unitId)
  path.forEach((unit, i) => {
    const successor = path[i + 1]
    if (successor && all.has(unit.unitId) && pendingWords(unit, ctx).length === 0) all.add(successor.unitId)
  })
  return all
}

/** The earliest unit, at or above the declared level, with a live never-introduced word. */
function firstPendingUnit(ctx: PathContext, ordered: readonly Unit[], unlocked: ReadonlySet<string>): Unit | null {
  for (const unit of ordered) {
    if (isBelow(unit, ctx.declaredLevel) || !unlocked.has(unit.unitId)) continue
    if (pendingWords(unit, ctx).length > 0) return unit
  }
  return null
}

/**
 * Unit IDs to add to the unlock set, in path order. Never returns a removal.
 */
export function computeUnlocks(ctx: PathContext): string[] {
  const ordered = inPathOrder(ctx.units)
  const all = unlockedSet(ctx, ordered)
  return ordered.map((u) => u.unitId).filter((id) => all.has(id) && !ctx.unlocked.has(id))
}

/** The earliest unlocked unit, at or above the declared level, with a live never-introduced word. */
export function currentUnit(ctx: PathContext): Unit | null {
  const ordered = inPathOrder(ctx.units)
  return firstPendingUnit(ctx, ordered, unlockedSet(ctx, ordered))
}

/**
 * The path's new-word queue: up to `limit` words, in path order, starting at
 * the current unit. It runs on into the following units, because introducing
 * the last word of a unit is exactly what unlocks the next one.
 */
export function pathNewWords(ctx: PathContext, limit: number): WordId[] {
  const out: WordId[] = []
  const ordered = inPathOrder(ctx.units)
  const start = firstPendingUnit(ctx, ordered, unlockedSet(ctx, ordered))
  if (!start) return out
  for (const unit of ordered) {
    if (unit.order < start.order || isBelow(unit, ctx.declaredLevel)) continue
    for (const id of pendingWords(unit, ctx)) {
      if (out.length >= limit) return out
      out.push(id)
    }
  }
  return out
}
```

Append to `core/src/index.ts`:

```ts
export * from './path'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 71 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): level path, unit unlocks and the path queue"
```

---

### Task 8: Session composition

**Files:**
- Create: `core/src/session.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/session.test.ts`

**Interfaces:**
- Consumes: `isDue`, `localDay`, `retrievability`, `ReviewState`, `RETENTION_TARGETS` (Task 3); `WordFlag` (Task 2); `WordId` (Task 1). `pathNew` is what `pathNewWords` (Task 7) returns.
- Produces: `DEFAULT_NEW_WORD_LIMIT = 10`; `MAX_NEW_WORD_LIMIT = 30`; `DEFAULT_REVIEW_CAP = 100`; `SessionInput`; `SessionPlan { reviews, newWords, backlogTotal, newWordsPaused }`; `composeSession(input: SessionInput): SessionPlan`.

The home screen and a session make the **same call** with `today = localDay(now, tzOffsetMin)`, so the *due today* figure (`reviews.length`) is exactly what a session serves; `backlogTotal` is the secondary number (spec §7.4). Same-day relearn repeats bypass the daily cap and are not part of the backlog. A collection takes the quota only if it still has a servable word; otherwise the path resumes. `reviewsDoneToday` is the caller's count of distinct words, introduced before today, that have had their first scheduled review today.

- [ ] **Step 1: Write the failing test**

`core/src/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyGrade, localDay, RETENTION_TARGETS, type ReviewState } from './scheduler'
import { composeSession, MAX_NEW_WORD_LIMIT, type SessionInput } from './session'
import { Grade, type WordFlag } from './types'
import { corpusWordId, type WordId } from './wordId'

const w = (n: number) => corpusWordId(`en-${String(n).padStart(6, '0')}`)
/** Sofia winter time: minutes to ADD to UTC. */
const TZ = 120
/** The instant at which the learner's local wall clock reads `hour`:`minute` on day `day` of the run. */
const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 0, 5 + day, hour, minute) - TZ * 60_000
const TODAY_INDEX = 30
/** This morning, 09:00 local. */
const NOW = at(TODAY_INDEX, 9)
const TODAY = localDay(NOW, TZ)

/** A word first seen on the evening `daysAgo` local days back and rated Good once. */
function seen(n: number, daysAgo: number): [WordId, ReviewState] {
  return [w(n), applyGrade(null, w(n), Grade.Good, at(TODAY_INDEX - daysAgo, 20), TZ)]
}

function input(over: Partial<SessionInput> = {}): SessionInput {
  return {
    now: NOW,
    today: TODAY,
    states: new Map(),
    flags: new Map(),
    retention: RETENTION_TARGETS.standard,
    newWordLimit: 10,
    reviewCap: 100,
    reviewsDoneToday: 0,
    newWordsDoneToday: 0,
    personalNew: [],
    collectionNew: null,
    pathNew: [],
    ...over,
  }
}

describe('composeSession: reviews', () => {
  it('serves only due words, lowest retrievability first', () => {
    const plan = composeSession(input({ states: new Map([seen(1, 5), seen(2, 20), seen(3, 1), seen(4, 10)]) }))
    expect(plan.reviews).toEqual([w(2), w(4), w(1)])
    expect(plan.backlogTotal).toBe(3)
  })

  it('leaves known and suspended words out of review without touching their state', () => {
    const states = new Map([seen(1, 5), seen(2, 5), seen(3, 5)])
    const flags = new Map<WordId, WordFlag>([[w(1), 'known'], [w(2), 'suspended']])
    const plan = composeSession(input({ states, flags }))
    expect(plan.reviews).toEqual([w(3)])
    expect(states.size).toBe(3)
  })

  it('is one call for the home screen and the session: a word due today is due all day', () => {
    // Studied yesterday evening, one day of interval: due from the first minute of today.
    const yesterday = applyGrade(null, w(1), Grade.Good, at(TODAY_INDEX - 1, 20, 30), TZ)
    const states = new Map([[w(1), { ...yesterday, stability: 1 }]])
    expect(composeSession(input({ states })).reviews).toEqual([w(1)])
    expect(composeSession(input({ states, now: at(TODAY_INDEX, 0, 5) })).reviews).toEqual([w(1)])
    expect(composeSession(input({ states, now: at(TODAY_INDEX, 23, 55) })).reviews).toEqual([w(1)])
    // And not yet on the day it was studied.
    const lastNight = input({ states, now: at(TODAY_INDEX - 1, 23, 0), today: TODAY - 1 })
    expect(composeSession(lastNight).reviews).toEqual([])
  })

  it('reschedules immediately when desired retention changes', () => {
    const states = new Map([[w(1), { ...seen(1, 6)[1], stability: 10 }]])
    expect(composeSession(input({ states, retention: RETENTION_TARGETS.standard })).reviews).toEqual([])
    expect(composeSession(input({ states, retention: RETENTION_TARGETS.intensive })).reviews).toEqual([w(1)])
  })
})

describe('composeSession: backlog protection', () => {
  const backlog = new Map(Array.from({ length: 12 }, (_, i) => seen(i + 1, 10)))

  it('caps the day’s reviews, reports the whole backlog, and pauses new words', () => {
    const plan = composeSession(input({ states: backlog, reviewCap: 5, pathNew: [w(100)] }))
    expect(plan.reviews).toHaveLength(5)
    expect(plan.backlogTotal).toBe(12)
    expect(plan.newWordsPaused).toBe(true)
    expect(plan.newWords).toEqual([])
  })

  it('counts reviews already done today against the cap', () => {
    const plan = composeSession(input({ states: backlog, reviewCap: 5, reviewsDoneToday: 3 }))
    expect(plan.reviews).toHaveLength(2)
    expect(composeSession(input({ states: backlog, reviewCap: 5, reviewsDoneToday: 9 })).reviews).toEqual([])
  })

  it('resumes new words once the backlog fits under the cap', () => {
    const plan = composeSession(input({ states: backlog, reviewCap: 12, pathNew: [w(100)] }))
    expect(plan.newWordsPaused).toBe(false)
    expect(plan.newWords).toEqual([w(100)])
  })

  it('lets a word rated Again today come back even with the cap exhausted', () => {
    const ts = NOW - 11 * 60 * 1000
    const lapsed = applyGrade(applyGrade(null, w(1), Grade.Good, at(TODAY_INDEX - 9, 20), TZ), w(1), Grade.Again, ts, TZ)
    const plan = composeSession(
      input({ states: new Map([[w(1), lapsed]]), reviewCap: 5, reviewsDoneToday: 5, pathNew: [w(100)] }),
    )
    expect(plan.reviews).toEqual([w(1)])
    expect(plan.backlogTotal).toBe(0)
    expect(plan.newWordsPaused).toBe(false)
  })

  it('serves the capped scheduled words first, then today’s relearns', () => {
    const backlogStates = new Map(Array.from({ length: 3 }, (_, i) => seen(i + 1, 10)))
    const ts = NOW - 11 * 60 * 1000
    const lapsed = applyGrade(applyGrade(null, w(9), Grade.Good, at(TODAY_INDEX - 9, 20), TZ), w(9), Grade.Again, ts, TZ)
    const states = new Map([...backlogStates, [w(9), lapsed]])
    const plan = composeSession(input({ states, reviewCap: 2 }))
    expect(plan.reviews).toHaveLength(3)
    expect(plan.reviews.at(-1)).toBe(w(9))
    expect(plan.backlogTotal).toBe(3)
    expect(plan.newWordsPaused).toBe(true)
  })

  it('does not serve a word rated Again before the relearn delay has passed', () => {
    const ts = NOW - 60 * 1000
    const lapsed = applyGrade(applyGrade(null, w(1), Grade.Good, at(TODAY_INDEX - 9, 20), TZ), w(1), Grade.Again, ts, TZ)
    expect(composeSession(input({ states: new Map([[w(1), lapsed]]) })).reviews).toEqual([])
  })
})

describe('composeSession: new words', () => {
  it('takes personal words first, then the path, up to what is left of the daily limit', () => {
    const plan = composeSession(
      input({ newWordLimit: 4, newWordsDoneToday: 1, personalNew: [w(50)], pathNew: [w(1), w(2), w(3)] }),
    )
    expect(plan.newWords).toEqual([w(50), w(1), w(2)])
  })

  it('gives an active collection the whole quota, and the path waits', () => {
    const plan = composeSession(input({ newWordLimit: 5, collectionNew: [w(70), w(71)], pathNew: [w(1), w(2), w(3)] }))
    expect(plan.newWords).toEqual([w(70), w(71)])
  })

  it('falls back to the path when the collection is exhausted or cleared', () => {
    expect(composeSession(input({ collectionNew: [], pathNew: [w(1)] })).newWords).toEqual([w(1)])
    expect(composeSession(input({ collectionNew: null, pathNew: [w(1)] })).newWords).toEqual([w(1)])
  })

  it('falls back to the path when every word left in the collection is introduced or flagged', () => {
    const plan = composeSession(
      input({
        states: new Map([seen(70, 3)]),
        flags: new Map<WordId, WordFlag>([[w(71), 'known'], [w(72), 'suspended']]),
        collectionNew: [w(70), w(71), w(72)],
        pathNew: [w(1), w(2)],
      }),
    )
    expect(plan.newWords).toEqual([w(1), w(2)])
  })

  it('still gives the collection the whole quota while one servable word is left in it', () => {
    const plan = composeSession(
      input({
        states: new Map([seen(70, 3)]),
        collectionNew: [w(70), w(71)],
        pathNew: [w(1), w(2)],
      }),
    )
    expect(plan.newWords).toEqual([w(71)])
  })

  it('only reviews when the limit is 0', () => {
    const plan = composeSession(input({ newWordLimit: 0, states: new Map([seen(1, 5)]), pathNew: [w(2)] }))
    expect(plan.reviews).toEqual([w(1)])
    expect(plan.newWords).toEqual([])
  })

  it('clamps the daily limit to the configurable range', () => {
    const pathNew = Array.from({ length: 50 }, (_, i) => w(i + 1))
    expect(composeSession(input({ newWordLimit: 999, pathNew })).newWords).toHaveLength(MAX_NEW_WORD_LIMIT)
    expect(composeSession(input({ newWordLimit: -5, pathNew })).newWords).toEqual([])
  })

  it('never offers a word that is already introduced, flagged, or listed twice', () => {
    const plan = composeSession(
      input({
        states: new Map([seen(1, 0)]),
        flags: new Map<WordId, WordFlag>([[w(2), 'known']]),
        personalNew: [w(3)],
        pathNew: [w(1), w(2), w(3), w(4)],
      }),
    )
    expect(plan.newWords).toEqual([w(3), w(4)])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './session'`.

- [ ] **Step 3: Implement**

`core/src/session.ts`:

```ts
import { isDue, retrievability, type ReviewState } from './scheduler'
import type { WordFlag } from './types'
import type { WordId } from './wordId'

/** Defaults and bounds for the learner's settings (spec §7.4). Tuning values (§15). */
export const DEFAULT_NEW_WORD_LIMIT = 10
export const MAX_NEW_WORD_LIMIT = 30
export const DEFAULT_REVIEW_CAP = 100

export interface SessionInput {
  readonly now: number
  /**
   * The learner's local day number: `localDay(now, tzOffsetMin)`. Due-ness is a
   * question about the calendar day (spec §8.4), so the home screen's count and
   * the session it starts are the same call and give the same numbers.
   */
  readonly today: number
  readonly states: ReadonlyMap<WordId, ReviewState>
  readonly flags: ReadonlyMap<WordId, WordFlag>
  /** Desired retention, e.g. RETENTION_TARGETS.standard. */
  readonly retention: number
  readonly newWordLimit: number
  readonly reviewCap: number
  /**
   * Distinct words, introduced before today, whose first scheduled
   * (non-practice) review of the day has been answered. Same-day repeats and
   * follow-ups of words introduced today do not count.
   */
  readonly reviewsDoneToday: number
  readonly newWordsDoneToday: number
  /** New-word sources, each in serve order. Personal words are empty until Phase 2. */
  readonly personalNew: readonly WordId[]
  /** Null when no collection is active. */
  readonly collectionNew: readonly WordId[] | null
  readonly pathNew: readonly WordId[]
}

export interface SessionPlan {
  /** Due words to review now, weakest first, within today's cap. */
  readonly reviews: readonly WordId[]
  readonly newWords: readonly WordId[]
  /** Everything scheduled for today, ignoring the cap: the home screen's secondary number. */
  readonly backlogTotal: number
  /** True when the backlog exceeds the cap, so new words wait. */
  readonly newWordsPaused: boolean
}

interface DueWord {
  readonly wordId: WordId
  readonly r: number
}

/** Weakest memory first, with a stable tie-break so every device agrees. */
function weakestFirst(a: DueWord, b: DueWord): number {
  return a.r - b.r || (a.wordId < b.wordId ? -1 : 1)
}

export function composeSession(input: SessionInput): SessionPlan {
  // Words rated Again earlier today are a repeat of work already started: the
  // daily cap and the backlog are about words the schedule brought up today.
  const scheduled: DueWord[] = []
  const relearning: DueWord[] = []
  for (const [wordId, state] of input.states) {
    if (input.flags.has(wordId)) continue
    if (!isDue(state, input.retention, input.now, input.today)) continue
    const due: DueWord = { wordId, r: retrievability(state, input.now) }
    if (state.lastReviewDay === input.today) relearning.push(due)
    else scheduled.push(due)
  }
  scheduled.sort(weakestFirst)
  relearning.sort(weakestFirst)

  const capLeft = Math.max(0, input.reviewCap - input.reviewsDoneToday)
  const newWordsPaused = scheduled.length > capLeft
  const limit = Math.min(Math.max(input.newWordLimit, 0), MAX_NEW_WORD_LIMIT)
  const quota = newWordsPaused ? 0 : Math.max(0, limit - input.newWordsDoneToday)

  // Only words that can still be introduced decide which source is live: a
  // collection whose remaining words are all introduced or flagged is spent,
  // and the path resumes (spec §7.4).
  const servable = (wordId: WordId) => !input.states.has(wordId) && !input.flags.has(wordId)
  const personal = input.personalNew.filter(servable)
  const collection = (input.collectionNew ?? []).filter(servable)
  const path = input.pathNew.filter(servable)

  // An active collection with words left takes the whole quota; the path waits.
  const newWords: WordId[] = []
  for (const source of [personal, collection.length > 0 ? collection : path]) {
    for (const wordId of source) {
      if (newWords.length >= quota) break
      if (!newWords.includes(wordId)) newWords.push(wordId)
    }
  }

  return {
    reviews: [...scheduled.slice(0, capLeft), ...relearning].map((d) => d.wordId),
    newWords,
    backlogTotal: scheduled.length,
    newWordsPaused,
  }
}
```

Append to `core/src/index.ts`:

```ts
export * from './session'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 89 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add core/src
git commit -m "feat(core): session composition with backlog protection"
```

---

### Task 9: Distractors and matching boards

**Files:**
- Create: `core/src/distractors.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/distractors.test.ts`

**Interfaces:**
- Consumes: `CorpusEntry`, `CefrLevel` (Task 2); `Rng`, `shuffle`, `seededRng` (Task 6).
- Produces: `DistractorContext { pool, encountered: ReadonlySet<WordId>, listening }`; `isValidDistractor(target: CorpusEntry, candidate: CorpusEntry, listening: boolean): boolean`; `pickDistractors(target: CorpusEntry, ctx: DistractorContext, count: number, rng: Rng): CorpusEntry[]`; `buildMatchingBoard(candidates: readonly CorpusEntry[], size: number, rng: Rng): CorpusEntry[] | null`.

Band and part of speech are strong preferences, not filters: a rare part of speech must still get three options. The exclusions — shared translation, another sense of the headword, a retired entry, a homophone in listening — are absolute, and apply between distractors as well as against the target, so that two options never show the same translation.

- [ ] **Step 1: Write the failing test**

`core/src/distractors.test.ts`:

```ts
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildMatchingBoard, isValidDistractor, pickDistractors, type DistractorContext } from './distractors'
import { seededRng } from './rng'
import type { CefrLevel, CorpusEntry } from './types'
import { corpusWordId, type WordId } from './wordId'

let n = 0
function entry(headword: string, translations: string[], over: Partial<CorpusEntry> = {}): CorpusEntry {
  n += 1
  return {
    entryId: `en-${String(n).padStart(6, '0')}`,
    headword,
    pos: 'adjective',
    level: 'A1',
    ipa: `/${headword}/`,
    unitId: 'a1-u1',
    themes: [],
    translations,
    retired: false,
    ...over,
  }
}

const big = entry('big', ['голям'])
const large = entry('large', ['голям', 'едър'])
const small = entry('small', ['малък'])
const bad = entry('bad', ['лош'])
const hot = entry('hot', ['горещ'])
const cold = entry('cold', ['студен'])
const old = entry('old', ['стар'], { retired: true })
const bankMoney = entry('bank', ['банка'], { pos: 'noun' })
const bankRiver = entry('bank', ['бряг'], { pos: 'noun' })
const their = entry('their', ['техен'], { pos: 'determiner', ipa: '/ðeə/' })
const there = entry('there', ['там'], { pos: 'adverb', ipa: '/ðeə/' })
const POOL = [big, large, small, bad, hot, cold, old, bankMoney, bankRiver, their, there]

const ctx = (over: Partial<DistractorContext> = {}): DistractorContext => ({
  pool: POOL,
  encountered: new Set<WordId>(),
  listening: false,
  ...over,
})

describe('isValidDistractor', () => {
  it('excludes the target, retired entries, synonyms and other senses of the headword', () => {
    expect(isValidDistractor(big, big, false)).toBe(false)
    expect(isValidDistractor(big, old, false)).toBe(false)
    expect(isValidDistractor(big, large, false)).toBe(false)
    expect(isValidDistractor(bankMoney, bankRiver, false)).toBe(false)
    expect(isValidDistractor(big, small, false)).toBe(true)
  })

  it('compares translations case-insensitively, alternates included', () => {
    expect(isValidDistractor(entry('huge', ['Едър']), large, false)).toBe(false)
  })

  it('folds case and Unicode form the same way everywhere, whatever the host locale', () => {
    expect(isValidDistractor(entry('Irish', ['ирландски']), entry('irish', ['ирски']), false)).toBe(false)
    const precomposed = entry('fee', ['év']) // é
    const combining = entry('charge', ['év']) // e + combining acute
    expect(isValidDistractor(precomposed, combining, false)).toBe(false)
  })

  it('excludes homophones in listening modes only', () => {
    expect(isValidDistractor(their, there, true)).toBe(false)
    expect(isValidDistractor(their, there, false)).toBe(true)
  })
})

describe('pickDistractors', () => {
  it('returns the requested number of valid options', () => {
    const out = pickDistractors(big, ctx(), 3, seededRng(1))
    expect(out).toHaveLength(3)
    for (const d of out) expect(isValidDistractor(big, d, false)).toBe(true)
  })

  it('prefers the target’s band and part of speech', () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const out = pickDistractors(big, ctx(), 3, seededRng(seed))
      expect(out.every((d) => d.pos === 'adjective' && d.level === 'A1')).toBe(true)
    }
  })

  it('prefers words the learner has met, keyed by WordId as the caller holds them', () => {
    const encountered = new Set([corpusWordId(hot.entryId)])
    for (let seed = 0; seed < 25; seed += 1) {
      expect(pickDistractors(big, ctx({ encountered }), 1, seededRng(seed))).toEqual([hot])
    }
  })

  it('relaxes band and part of speech rather than coming up short', () => {
    const out = pickDistractors(their, ctx(), 3, seededRng(3))
    expect(out).toHaveLength(3)
  })

  it('returns what it can when the pool is too small', () => {
    expect(pickDistractors(big, ctx({ pool: [big, large, small] }), 3, seededRng(1))).toEqual([small])
  })

  it('varies between calls', () => {
    const seen = new Set<string>()
    for (let seed = 0; seed < 40; seed += 1) {
      seen.add(pickDistractors(big, ctx(), 3, seededRng(seed)).map((d) => d.headword).sort().join())
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('distractor invariants (spec §13)', () => {
  const tr = fc.constantFrom('а', 'б', 'в', 'г', 'д', 'е', 'ж', 'з', 'и', 'к', 'л', 'м')
  const entryArb = fc.record({
    headword: fc.constantFrom('ant', 'bat', 'cat', 'dog', 'eel', 'fox', 'gnu', 'hen', 'ibis', 'jay'),
    pos: fc.constantFrom('noun', 'verb'),
    level: fc.constantFrom<CefrLevel>('A1', 'A2'),
    ipa: fc.constantFrom('/a/', '/b/', '/c/', '/d/', '/e/', '/f/'),
    translations: fc.uniqueArray(tr, { minLength: 1, maxLength: 3 }),
    retired: fc.boolean(),
  })
  const poolArb = fc
    .array(entryArb, { minLength: 1, maxLength: 30 })
    .map((pool) => pool.map((e, i): CorpusEntry => ({ ...e, entryId: `e${i}`, unitId: 'u', themes: [] })))

  it('no distractor is ambiguous with its target or with another distractor', () => {
    fc.assert(
      fc.property(poolArb, fc.boolean(), fc.nat(), (pool, listening, seed) => {
        const target = pool[0]!
        const out = pickDistractors(target, { pool, encountered: new Set<WordId>(), listening }, 3, seededRng(seed))
        const shown = [target, ...out]
        for (const d of out) expect(d.retired).toBe(false)
        for (let i = 0; i < shown.length; i += 1) {
          for (let j = i + 1; j < shown.length; j += 1) {
            const a = shown[i]!
            const b = shown[j]!
            expect(a.headword).not.toBe(b.headword)
            expect(a.translations.filter((t) => b.translations.includes(t))).toEqual([])
            if (listening) expect(a.ipa).not.toBe(b.ipa)
          }
        }
      }),
    )
  })

  it('no two pairs on a matching board share a headword or a translation', () => {
    fc.assert(
      fc.property(poolArb, fc.nat(), (pool, seed) => {
        const board = buildMatchingBoard(pool, 5, seededRng(seed))
        if (board === null) return
        expect(board).toHaveLength(5)
        expect(new Set(board.map((e) => e.headword)).size).toBe(5)
        const all = board.flatMap((e) => e.translations)
        expect(new Set(all).size).toBe(all.length)
        expect(board.some((e) => e.retired)).toBe(false)
      }),
    )
  })
})

describe('buildMatchingBoard', () => {
  it('fills a board from unambiguous entries', () => {
    const board = buildMatchingBoard(POOL, 5, seededRng(5))
    expect(board).toHaveLength(5)
  })

  it('returns null when it cannot', () => {
    expect(buildMatchingBoard([big, large, small], 3, seededRng(5))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './distractors'`.

- [ ] **Step 3: Implement**

`core/src/distractors.ts`:

```ts
import { shuffle, type Rng } from './rng'
import type { CorpusEntry } from './types'
import { corpusWordId, type WordId } from './wordId'

export interface DistractorContext {
  /** Candidate entries: normally the whole loaded corpus. */
  readonly pool: readonly CorpusEntry[]
  /** Words the learner has already met, e.g. `new Set(states.keys())`; these are preferred. */
  readonly encountered: ReadonlySet<WordId>
  /** True for listening modes, where homophones are excluded too. */
  readonly listening: boolean
}

// Locale-independent by construction: `core` derives the same result everywhere.
const norm = (s: string) => s.trim().normalize('NFC').toLowerCase()

function sharesTranslation(a: CorpusEntry, b: CorpusEntry): boolean {
  const mine = new Set(a.translations.map(norm))
  return b.translations.some((t) => mine.has(norm(t)))
}

/** Two entries that could not both appear on screen without ambiguity. */
function clash(a: CorpusEntry, b: CorpusEntry, listening: boolean): boolean {
  return (
    norm(a.headword) === norm(b.headword) ||
    sharesTranslation(a, b) ||
    (listening && a.ipa !== '' && a.ipa === b.ipa)
  )
}

/** A distractor must be unambiguously wrong (spec §8.1). */
export function isValidDistractor(target: CorpusEntry, candidate: CorpusEntry, listening: boolean): boolean {
  return candidate.entryId !== target.entryId && !candidate.retired && !clash(target, candidate, listening)
}

function score(target: CorpusEntry, c: CorpusEntry, ctx: DistractorContext, rng: Rng): number {
  const a = norm(target.headword)
  const b = norm(c.headword)
  const lookalike = (a[0] === b[0] ? 1 : 0) + (Math.abs(a.length - b.length) <= 1 ? 1 : 0)
  return (
    (c.level === target.level ? 8 : 0) +
    (c.pos === target.pos ? 4 : 0) +
    (ctx.encountered.has(corpusWordId(c.entryId)) ? 3 : 0) +
    lookalike * (ctx.listening ? 2 : 1) +
    rng() * 1.5 // so the same word does not always meet the same distractors
  )
}

/**
 * Picks up to `count` wrong options for `target`: same band and part of speech
 * where possible, never ambiguous with the target or with each other. Returns
 * fewer than `count` only when the pool cannot supply them.
 */
export function pickDistractors(
  target: CorpusEntry,
  ctx: DistractorContext,
  count: number,
  rng: Rng,
): CorpusEntry[] {
  const ranked = shuffle(ctx.pool, rng)
    .filter((c) => isValidDistractor(target, c, ctx.listening))
    .map((entry) => ({ entry, score: score(target, entry, ctx, rng) }))
    .sort((x, y) => y.score - x.score)
  const chosen: CorpusEntry[] = []
  for (const { entry } of ranked) {
    if (chosen.length >= count) break
    if (!chosen.some((other) => clash(entry, other, ctx.listening))) chosen.push(entry)
  }
  return chosen
}

/**
 * Chooses `size` entries for a matching board on which no two pairs share a
 * headword or a translation. Null when the candidates cannot fill a board.
 */
export function buildMatchingBoard(
  candidates: readonly CorpusEntry[],
  size: number,
  rng: Rng,
): CorpusEntry[] | null {
  const board: CorpusEntry[] = []
  for (const entry of shuffle(candidates, rng)) {
    if (board.length >= size) break
    if (!entry.retired && !board.some((other) => clash(entry, other, false))) board.push(entry)
  }
  return board.length === size ? board : null
}
```

Append to `core/src/index.ts`:

```ts
export * from './distractors'
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: 103 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Verify the purity guard still holds**

```bash
printf "export const leak = () => [fetch('x'), process.env, document.title]\n" > core/src/_leak.ts
pnpm typecheck; rm core/src/_leak.ts
```

Expected: `tsc` reports `Cannot find name 'fetch'`, `'process'` and `'document'`, and the typecheck fails. If it passes, the compiler options have been loosened — restore `"lib": ["ES2022"]` and `"types": []` in `tsconfig.base.json`.

- [ ] **Step 6: Commit**

```bash
git add core/src
git commit -m "feat(core): synonym-safe distractors and matching boards"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| §6.1 namespaced `word_id`; aliases resolved at replay, events never rewritten | 1, 4 |
| §7.1 FSRS, default parameters; desired retention moves due dates, not stability | 3, 8 |
| §8.4 a day is the learner's local calendar date — the unit scheduling counts in | 3, 4, 8 |
| §8.1, §13 matching events never alter review state, enforced in replay | 4 |
| §7.2 placement consequences, assumed known, unit unlock rule, current unit | 7 |
| §7.3 grade mapping; binary modes never *Easy*; latency grading can be switched off (§11.1) | 2 |
| §7.4 due first by retrievability; new-word sources and limit; backlog cap; known and suspended | 8 |
| §7.5 recognition → recall escalation; listening only when playable | 6 |
| §8.1 distractor rules, homophones, matching boards | 9 |
| §8.3 mastery tiers | 5 |
| §9.2 replay order, dedupe on `review_id`, practice skipped | 4 |
| §4.3 `scheduler_version`, pinned by a test | 3 |
| §13 property tests: replay convergence; queue never dry; distractor invariants; mode selection never picks listening without audio | 4, 6, 7, 9 |

Left for plan 2 (see the roadmap): XP, streaks, event stamping, the rebase rule, document merge, entitlement and the capability check, retention rate, level and unit completion markers, placement test scoring. Typo tolerance and synonym handling in typing modes are Phase 2 of the product.
