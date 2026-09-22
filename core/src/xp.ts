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
