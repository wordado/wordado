import {
  awardXp,
  classifyEvents,
  DOCUMENT_TYPES,
  isWordId,
  replay,
  resolveAlias,
  SCHEDULER_VERSION,
  utcDay,
  type AliasMap,
  type ClassifiedEvent,
  type EventKind,
  type ReviewState,
  type WordId,
} from '@wordado/core'
import type { Queryable } from '../db/db'
import { loadEvents, type StoredEvent } from './events'

/** A learner whose stored state must be rebuilt from the log; never a real scheduler version. */
export const STALE = 'stale'

/** The learner's live aliases (spec §6.1). Empty until Phase 2's personal dictionary. */
export async function loadAliases(tx: Queryable, userId: string): Promise<Map<WordId, WordId>> {
  const rows = await tx.query<{ key: string; target: unknown }>(
    `select key, fields -> 'target' as target from document where user_id = $1 and type = $2 and not deleted`,
    [userId, DOCUMENT_TYPES.wordAlias],
  )
  const out = new Map<WordId, WordId>()
  for (const { key, target } of rows) if (isWordId(key) && typeof target === 'string' && isWordId(target)) out.set(key, target)
  return out
}

/** Every raw word ID whose events derive one of `resolved`: the words themselves and the user words merged into them. */
function rawIdsFor(resolved: ReadonlySet<WordId>, aliases: AliasMap): WordId[] {
  const out = new Set<WordId>(resolved)
  for (const key of aliases.keys()) if (resolved.has(resolveAlias(key, aliases))) out.add(key)
  return [...out]
}

/** Stores the kinds that changed; returns the UTC days those events fall on. */
async function writeKinds(tx: Queryable, userId: string, classified: readonly ClassifiedEvent<StoredEvent>[]): Promise<Set<number>> {
  const changed: { review_id: string; kind: EventKind }[] = []
  const days = new Set<number>()
  for (const { event, kind } of classified) {
    if (kind === event.kind) continue
    changed.push({ review_id: event.reviewId, kind })
    days.add(utcDay(event.effectiveTs))
  }
  if (changed.length > 0) {
    await tx.query(
      `update review_event e set kind = c.kind
       from jsonb_to_recordset($2::jsonb) as c(review_id text, kind text)
       where e.user_id = $1 and e.review_id = c.review_id`,
      [userId, JSON.stringify(changed)],
    )
  }
  return days
}

/** Replaces the stored state of the given words (all of them when `wordIds` is null). */
async function writeStates(tx: Queryable, userId: string, wordIds: readonly WordId[] | null, states: readonly ReviewState[]): Promise<void> {
  if (wordIds === null) await tx.query('delete from review_state where user_id = $1', [userId])
  else await tx.query('delete from review_state where user_id = $1 and word_id = any($2::text[])', [userId, wordIds])
  if (states.length === 0) return
  await tx.query(
    `insert into review_state (user_id, word_id, state)
     select $1, s.word_id, s.state from jsonb_to_recordset($2::jsonb) as s(word_id text, state jsonb)`,
    [userId, JSON.stringify(states.map((state) => ({ word_id: state.wordId, state })))],
  )
}

/**
 * Re-awards XP for whole UTC days (spec §8.7: the cap is per UTC day and
 * spent in replay order), from the kinds already stored.
 */
export async function recomputeXpDays(tx: Queryable, userId: string, days: ReadonlySet<number>): Promise<void> {
  if (days.size === 0) return
  const rows = await tx.query<{
    review_id: string
    effective_ts: number
    device_id: string
    device_seq: number
    xp_eligible: boolean
    kind: EventKind
    xp_award: number
  }>(
    `select review_id, effective_ts, device_id, device_seq, xp_eligible, kind, xp_award
     from review_event where user_id = $1 and utc_day = any($2::int[])`,
    [userId, [...days]],
  )
  const { awards } = awardXp(
    rows.map((r) => ({
      event: { reviewId: r.review_id, effectiveTs: r.effective_ts, deviceId: r.device_id, deviceSeq: r.device_seq, xpEligible: r.xp_eligible },
      kind: r.kind,
    })),
  )
  const changed = rows
    .filter((r) => (awards.get(r.review_id) ?? 0) !== r.xp_award)
    .map((r) => ({ review_id: r.review_id, xp_award: awards.get(r.review_id) ?? 0 }))
  if (changed.length === 0) return
  await tx.query(
    `update review_event e set xp_award = c.xp_award
     from jsonb_to_recordset($2::jsonb) as c(review_id text, xp_award integer)
     where e.user_id = $1 and e.review_id = c.review_id`,
    [userId, JSON.stringify(changed)],
  )
}

/**
 * Re-derives what a push changed (spec §4.4: only the words those events
 * touch): the kinds of every event of those words, their review state, and
 * the XP of each UTC day whose kinds changed or that received events.
 * Classification and replay are per word after alias resolution, so a word's
 * own events are all they read; the XP cap is per UTC day, so a day's events
 * are all it reads. Call it after `insertEvents`, in the same transaction.
 */
export async function rederiveWords(
  tx: Queryable,
  userId: string,
  touched: Iterable<WordId>,
  receivedDays: Iterable<number>,
): Promise<void> {
  const aliases = await loadAliases(tx, userId)
  const resolved = new Set<WordId>([...touched].map((wordId) => resolveAlias(wordId, aliases)))
  const days = new Set(receivedDays)
  if (resolved.size > 0) {
    const rawIds = rawIdsFor(resolved, aliases)
    const events = await loadEvents(tx, userId, rawIds)
    for (const day of await writeKinds(tx, userId, classifyEvents(events, { aliases }))) days.add(day)
    // Tombstoned user words derive no state (plan 2); none exist before Phase 2's personal dictionary.
    await writeStates(tx, userId, rawIds, [...replay(events, aliases).values()])
  }
  await recomputeXpDays(tx, userId, days)
}

/**
 * Re-derives the learner's whole log (spec §4.3): after a scheduler change,
 * or after an alias changed which events belong to which word. Stamps are
 * read, never written. Records the scheduler version the state now reflects.
 */
export async function rederiveUser(tx: Queryable, userId: string): Promise<void> {
  const aliases = await loadAliases(tx, userId)
  const events = await loadEvents(tx, userId)
  await writeKinds(tx, userId, classifyEvents(events, { aliases }))
  await writeStates(tx, userId, null, [...replay(events, aliases).values()])
  // Every day, not only those whose kinds changed: the amounts or the cap may be what changed.
  await recomputeXpDays(tx, userId, new Set(events.map((e) => utcDay(e.effectiveTs))))
  await tx.query('update learner set derived_scheduler_version = $2, rederive_requested_at = null where user_id = $1', [
    userId,
    SCHEDULER_VERSION,
  ])
}

/** Marks the learner for a full re-derivation, which the cron requests (Task 8). */
export async function markStale(tx: Queryable, userId: string): Promise<void> {
  await tx.query('update learner set derived_scheduler_version = $2 where user_id = $1', [userId, STALE])
}
