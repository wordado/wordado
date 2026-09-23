import { Grade, SCHEDULER_VERSION, SYNC_PROTOCOL_VERSION, type PushPage, type ReviewEvent, type StampedReviewEvent } from '@wordado/core'

/** Sofia summer time: minutes to add to UTC. */
export const TZ = 180

let events = 0
let pushes = 0

/** An answer as a client records it. */
export function rawEvent(deviceId: string, deviceSeq: number, clientTs: number, over: Partial<ReviewEvent> = {}): ReviewEvent {
  events += 1
  return {
    reviewId: `r-${deviceId}-${deviceSeq}-${events}`,
    wordId: 'c:hello-1',
    mode: 'multiple_choice',
    direction: 'en_to_l1',
    grade: Grade.Good,
    latencyMs: 1500,
    practice: false,
    clientTs,
    clientTzOffsetMin: TZ,
    deviceId,
    deviceSeq,
    schedulerVersion: SCHEDULER_VERSION,
    ...over,
  }
}

/** The event as the server would have stamped it with no correction. */
export function stamped(event: ReviewEvent, over: Partial<StampedReviewEvent> = {}): StampedReviewEvent {
  return { ...event, receivedAt: event.clientTs, effectiveTs: event.clientTs, xpEligible: true, ...over }
}

/** A single-page push unless `over` says otherwise. */
export function pushPage(deviceId: string, clientNow: number, pageEvents: readonly ReviewEvent[], over: Partial<PushPage> = {}): PushPage {
  pushes += 1
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    pushId: `push-${pushes}`,
    clientNow,
    deviceId,
    page: 0,
    lastPage: true,
    events: pageEvents,
    dayComplete: [],
    documents: [],
    ...over,
  }
}
