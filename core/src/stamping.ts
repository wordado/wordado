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
