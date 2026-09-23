import {
  classifyEvents,
  computeXp,
  DAILY_XP_CAP,
  DOCUMENT_TYPES,
  Grade,
  replay,
  utcDay,
  type ReviewState,
  type StampedReviewEvent,
  type WordId,
} from '@wordado/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createTestUser, testDb } from '../../test/db'
import { rawEvent, stamped } from '../../test/events'
import type { Queryable } from '../db/db'
import { lockLearner } from '../learner'
import { rederiveUser, rederiveWords, STALE } from './derive'
import { insertEvents, loadEvents } from './events'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 8, 1, 6)

/** What the database holds, in core's terms. */
async function stored(tx: Queryable, userId: string) {
  const rows = await tx.query<{ word_id: WordId; state: ReviewState }>('select word_id, state from review_state where user_id = $1', [userId])
  const events = await loadEvents(tx, userId)
  return {
    states: new Map(rows.map((r) => [r.word_id, r.state])),
    kinds: new Map(events.map((e) => [e.reviewId, e.kind])),
    awards: new Map(events.map((e) => [e.reviewId, e.xpAward])),
  }
}

/** What core derives from the whole log. */
function derived(events: readonly StampedReviewEvent[], aliases: ReadonlyMap<WordId, WordId> = new Map()) {
  return {
    states: replay(events, aliases),
    kinds: new Map(classifyEvents(events, { aliases }).map((c) => [c.event.reviewId, c.kind])),
    awards: computeXp(events, { aliases }).awards,
  }
}

/** One push's worth of work, as Task 5's handler does it. */
async function ingest(userId: string, batch: readonly StampedReviewEvent[]): Promise<void> {
  await testDb().transaction(async (tx) => {
    await lockLearner(tx, userId)
    await insertEvents(tx, userId, batch)
    await rederiveWords(
      tx,
      userId,
      batch.map((e) => e.wordId),
      batch.map((e) => utcDay(e.effectiveTs)),
    )
  })
}

/** A user word, merged into `c:w-2` in the runs that seed the alias. */
const USER_WORD: WordId = 'u:w-1'
const ALIAS_TARGET: WordId = 'c:w-2'

/** Offsets whose local days disagree with the UTC day, and with each other, in different directions. */
const TZ_OFFSETS = [-300, 0, 180, 540] as const

/** Word 0 is the user word; the rest are corpus words. */
function wordOf(n: number): WordId {
  return n === 0 ? USER_WORD : `c:w-${n}`
}

interface AnswerSpec {
  readonly word: number
  readonly device: string
  readonly day: number
  readonly minute: number
  readonly tz: number
  readonly grade: number
  readonly practice: boolean
  readonly matching: boolean
  readonly eligible: boolean
}

const answer = fc.record({
  word: fc.integer({ min: 0, max: 6 }),
  device: fc.constantFrom('dev-a', 'dev-b'),
  day: fc.integer({ min: 0, max: 5 }),
  minute: fc.integer({ min: 0, max: 1439 }),
  tz: fc.constantFrom(...TZ_OFFSETS),
  grade: fc.integer({ min: 1, max: 4 }),
  practice: fc.boolean(),
  matching: fc.boolean(),
  eligible: fc.boolean(),
})

/**
 * Scheduled answers crowded into two UTC days — most on the first, all
 * between 06:00 and 24:00 UTC — over many words and three devices, so the
 * first day's XP runs past DAILY_XP_CAP; one in ten is ineligible. Unbiased:
 * fast-check's lean towards small integers would make most answers repeats
 * of a few words, which earn nothing.
 */
const crowdedAnswer = fc.noBias(
  fc.record({
    word: fc.integer({ min: 0, max: 400 }),
    device: fc.constantFrom('dev-a', 'dev-b', 'dev-c'),
    day: fc.integer({ min: 0, max: 9 }).map((n) => (n < 8 ? 0 : 1)),
    minute: fc.integer({ min: 0, max: 1079 }),
    tz: fc.constantFrom(...TZ_OFFSETS),
    grade: fc.integer({ min: 1, max: 4 }),
    practice: fc.constant(false),
    matching: fc.constant(false),
    eligible: fc.integer({ min: 0, max: 9 }).map((n) => n > 0),
  }),
)

/** A history, whether the alias is seeded, and for each answer the batch (0–3) it arrives in: later batches bring earlier answers too. */
function history(spec: fc.Arbitrary<AnswerSpec>, minLength: number, maxLength: number) {
  return fc
    .array(spec, { minLength, maxLength })
    .chain((specs) =>
      fc.tuple(
        fc.constant(specs),
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: specs.length, maxLength: specs.length }),
        fc.boolean(),
      ),
    )
}

function toEvents(specs: readonly AnswerSpec[]): StampedReviewEvent[] {
  const seq: Record<string, number> = {}
  return specs.map((s) => {
    seq[s.device] = (seq[s.device] ?? 0) + 1
    const ts = T0 + s.day * DAY + s.minute * 60_000
    return stamped(
      rawEvent(s.device, seq[s.device]!, ts, {
        wordId: wordOf(s.word),
        grade: s.grade as Grade,
        practice: s.practice && !s.matching,
        mode: s.matching ? 'matching' : 'multiple_choice',
        clientTzOffsetMin: s.tz,
      }),
      { xpEligible: s.eligible },
    )
  })
}

async function seedAlias(userId: string): Promise<void> {
  await testDb().query(
    `insert into document (user_id, type, key, class, version, fields, field_versions, deleted)
     values ($1, $2, $3, 'versioned', 2, $4::jsonb, '{"target": 2}'::jsonb, false)`,
    [userId, DOCUMENT_TYPES.wordAlias, USER_WORD, JSON.stringify({ target: ALIAS_TARGET })],
  )
}

/** Ingests the history in its batches and holds the stored rows equal to core's derivation of the whole log. */
async function checkHistory(specs: readonly AnswerSpec[], batchOf: readonly number[], withAlias: boolean) {
  const userId = await createTestUser()
  // Before the first batch, as a merge made on another device would be.
  if (withAlias) await seedAlias(userId)
  const aliases = new Map<WordId, WordId>(withAlias ? [[USER_WORD, ALIAS_TARGET]] : [])
  const events = toEvents(specs)
  for (let batch = 0; batch <= 3; batch += 1) await ingest(userId, events.filter((_, i) => batchOf[i] === batch))
  const got = await stored(testDb(), userId)
  const want = derived(events, aliases)
  expect(got.kinds).toEqual(want.kinds)
  expect(got.awards).toEqual(want.awards)
  expect(got.states).toEqual(want.states)
  return computeXp(events, { aliases })
}

describe('derivation (spec §4.3, §4.4)', () => {
  it('keeps state, kinds and awards equal to core over the whole log, whatever order batches arrive in', async () => {
    await fc.assert(
      fc.asyncProperty(history(answer, 1, 60), async ([specs, batchOf, withAlias]) => {
        await checkHistory(specs, batchOf, withAlias)
      }),
      { numRuns: 40 },
    )
  })

  it('keeps awards equal to core when batches in any order crowd a day past the XP cap (spec §8.7)', async () => {
    let capped = 0
    await fc.assert(
      fc.asyncProperty(history(crowdedAnswer, 160, 200), async ([specs, batchOf, withAlias]) => {
        const xp = await checkHistory(specs, batchOf, withAlias)
        if ([...xp.byUtcDay.values()].some((spent) => spent === DAILY_XP_CAP)) capped += 1
      }),
      { numRuns: 15 },
    )
    // The generator is only worth its runs if the cap actually binds.
    expect(capped).toBeGreaterThan(0)
  })

  it("lowers an earlier push's awards when a late device fills the day's cap first (spec §8.5)", async () => {
    const userId = await createTestUser()
    const later = Array.from({ length: 60 }, (_, i) => stamped(rawEvent('dev-a', i + 1, T0 + 3_600_000 + i * 60_000, { wordId: `c:later-${i}` })))
    const earlier = Array.from({ length: 60 }, (_, i) => stamped(rawEvent('dev-b', i + 1, T0 + i * 60_000, { wordId: `c:early-${i}` })))
    await ingest(userId, later)
    expect([...(await stored(testDb(), userId)).awards.values()].reduce((a, b) => a + b, 0)).toBe(600)
    await ingest(userId, earlier)
    const got = await stored(testDb(), userId)
    expect([...got.awards.values()].reduce((a, b) => a + b, 0)).toBe(1000)
    expect(got.awards).toEqual(derived([...later, ...earlier]).awards)
    expect(got.awards.get(later[59]!.reviewId)).toBe(0)
  })

  it('derives a user word merged into a corpus entry as one word (spec §6.1)', async () => {
    const db = testDb()
    const userId = await createTestUser(db)
    const mine = stamped(rawEvent('dev-a', 1, T0, { wordId: 'u:bank-mine' }))
    const corpus = stamped(rawEvent('dev-a', 2, T0 + 3 * DAY, { wordId: 'c:bank-1' }))
    await ingest(userId, [mine, corpus])
    await db.query(
      `insert into document (user_id, type, key, class, version, fields, field_versions, deleted)
       values ($1, $2, 'u:bank-mine', 'versioned', 2, $3::jsonb, '{"target": 2}'::jsonb, false)`,
      [userId, DOCUMENT_TYPES.wordAlias, JSON.stringify({ target: 'c:bank-1' })],
    )
    await db.transaction((tx) => rederiveUser(tx, userId))
    const aliases = new Map<WordId, WordId>([['u:bank-mine', 'c:bank-1']])
    const got = await stored(db, userId)
    expect([...got.states.keys()]).toEqual(['c:bank-1'])
    expect(got.states.get('c:bank-1')?.reps).toBe(2)
    expect(got).toEqual(derived([mine, corpus], aliases))
    // A later answer to the user word re-derives the entry it is merged into.
    const again = stamped(rawEvent('dev-a', 3, T0 + 6 * DAY, { wordId: 'u:bank-mine' }))
    await ingest(userId, [again])
    expect(await stored(db, userId)).toEqual(derived([mine, corpus, again], aliases))
  })

  it('rebuilds everything from the log and records the scheduler version', async () => {
    const db = testDb()
    const userId = await createTestUser(db)
    const events = Array.from({ length: 12 }, (_, i) => stamped(rawEvent('dev-a', i + 1, T0 + i * DAY, { wordId: `c:w-${i % 3}` })))
    await ingest(userId, events)
    // Damage every derived row, as a scheduler change would leave them.
    await db.query(`update review_event set kind = 'practice', xp_award = 7 where user_id = $1`, [userId])
    await db.query(`update review_state set state = '{}'::jsonb where user_id = $1`, [userId])
    await db.query('update learner set derived_scheduler_version = $2 where user_id = $1', [userId, STALE])
    await db.transaction((tx) => rederiveUser(tx, userId))
    expect(await stored(db, userId)).toEqual(derived(events))
    const [learner] = await db.query<{ derived_scheduler_version: string; rederive_requested_at: number | null }>(
      'select derived_scheduler_version, rederive_requested_at from learner where user_id = $1',
      [userId],
    )
    expect(learner?.derived_scheduler_version).not.toBe(STALE)
    expect(learner?.rederive_requested_at).toBeNull()
  })

  it('leaves no state for a word answered only in practice', async () => {
    const userId = await createTestUser()
    await ingest(userId, [stamped(rawEvent('dev-a', 1, T0, { wordId: 'c:only-practice', practice: true }))])
    expect((await stored(testDb(), userId)).states.size).toBe(0)
  })
})
