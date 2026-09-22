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
  const upperBound = input.serverNow
  // Server instances' clocks can differ by milliseconds: without this, a lower
  // bound just above the upper one would clamp (and so mark ineligible) every event.
  return { clockOffsetMs, lowerBound: Math.min(lowerBound, upperBound), upperBound }
}

function byDevice(a: ReviewEvent, b: ReviewEvent): number {
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1
  return a.deviceSeq - b.deviceSeq
}

/** Per device, what the next page of the same push needs to stamp consistently (spec §9.2). */
export interface DeviceCarry {
  readonly lastEffectiveTs: number
  /** This device's stamped timestamps within `DENSITY_WINDOW_MS` before and including `lastEffectiveTs`, ascending. */
  readonly recentTs: readonly number[]
}

/** By deviceId. Threaded from page to page of one push; empty on the first page. */
export type StampCarry = ReadonlyMap<string, DeviceCarry>

export interface StampResult {
  /** Ordered by (deviceId, deviceSeq). */
  readonly events: StampedReviewEvent[]
  /** The input carry, updated for every device this page touched. */
  readonly carry: StampCarry
}

/**
 * Assigns effective time and the XP verdict to one page of a push (spec §9.2
 * steps 2–4, §10). Returns the events ordered by (deviceId, deviceSeq). Pure:
 * stamping the same pages against the same window and carry gives the same stamps.
 */
export function stampEvents(
  events: readonly ReviewEvent[],
  pushWindow: PushWindow,
  receivedAt: number,
  carry: StampCarry = new Map(),
): StampResult {
  const ordered = [...events].sort(byDevice)
  const out: StampedReviewEvent[] = []
  let prevDevice: string | null = null
  let prevTs = Number.NEGATIVE_INFINITY
  for (const event of ordered) {
    if (event.deviceId !== prevDevice) {
      prevDevice = event.deviceId
      prevTs = carry.get(event.deviceId)?.lastEffectiveTs ?? Number.NEGATIVE_INFINITY
    }
    const corrected = event.clientTs + pushWindow.clockOffsetMs
    const clamped = Math.min(Math.max(corrected, pushWindow.lowerBound), pushWindow.upperBound)
    const wasClamped = clamped !== corrected
    // Restore device_seq order: never earlier than the device's previous event (in this page or the carry).
    const effectiveTs = Math.max(clamped, prevTs)
    prevTs = effectiveTs
    const plausible = event.latencyMs >= PLAUSIBILITY_FLOOR_MS[event.mode]
    out.push({ ...event, receivedAt, effectiveTs, xpEligible: !wasClamped && plausible })
  }
  const { events: densed, recentByDevice } = markDense(out, carry)
  const nextCarry = new Map(carry)
  for (const [deviceId, recentTs] of recentByDevice) {
    nextCarry.set(deviceId, { lastEffectiveTs: recentTs[recentTs.length - 1]!, recentTs })
  }
  return { events: densed, carry: nextCarry }
}

/**
 * Marks events XP-ineligible where one device's answers, carried density
 * included, exceed the density ceiling. An event moved only by order
 * restoration (never earlier than the device's previous stamp) still counts
 * toward density: rare, and documented rather than special-cased.
 */
function markDense(
  events: StampedReviewEvent[],
  carry: StampCarry,
): { events: StampedReviewEvent[]; recentByDevice: Map<string, number[]> } {
  const out: StampedReviewEvent[] = []
  const recentByDevice = new Map<string, number[]>()
  let currentDevice: string | null = null
  let windowTs: number[] = []
  for (const event of events) {
    if (event.deviceId !== currentDevice) {
      currentDevice = event.deviceId
      windowTs = [...(carry.get(event.deviceId)?.recentTs ?? [])]
    }
    windowTs = windowTs.filter((ts) => ts > event.effectiveTs - DENSITY_WINDOW_MS)
    windowTs.push(event.effectiveTs)
    out.push(windowTs.length > DENSITY_MAX_EVENTS ? { ...event, xpEligible: false } : event)
    recentByDevice.set(event.deviceId, windowTs)
  }
  return { events: out, recentByDevice }
}
