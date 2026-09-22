import type { DaySummary } from './activity'
import type { DocumentClass, DocumentPatch } from './documents'
import type { ReviewState } from './scheduler'
import type { ReviewEvent } from './types'

/**
 * The sync wire format (spec §9.2, §4.3), camelCase and field-for-field the
 * in-memory types, because both ends are `core` consumers. `client-data`
 * (plan 4) speaks it through `SyncTransport`; the server (plan 5) serves it.
 * The reference implementation is `client-data/src/testing/fakeServer.ts`.
 */
export const SYNC_PROTOCOL_VERSION = 1

/** Events per push page (spec §15: sized against the Workers CPU limit). */
export const SYNC_PAGE_SIZE = 500

/** `day_complete` on the wire: the local date as YYYY-MM-DD (plan 2 contract). */
export interface WireDayComplete {
  readonly localDate: string
  readonly ruleVersion: string
}

/** A client write to a versioned document: the changed fields plus the version it edited. */
export interface DocumentWrite {
  readonly type: string
  readonly key: string
  readonly patch: DocumentPatch<Record<string, unknown>>
}

/** A document as the server holds it. */
export interface WireDocument {
  readonly type: string
  readonly key: string
  readonly class: DocumentClass
  readonly version: number
  readonly fields: Record<string, unknown>
  readonly fieldVersions: Record<string, number>
  readonly deleted: boolean
  /** Server-owned documents only: when the client should try to refresh (spec §9.2). */
  readonly staleAfter: number | null
}

export interface DocumentRejection {
  readonly type: string
  readonly key: string
  readonly reason: 'server_owned' | 'base_ahead_of_server' | 'version_not_newer' | 'invalid'
}

/**
 * One page of a push. Every page of one push shares `pushId` and `clientNow`,
 * so the server fixes the window once (spec §9.2 step 1). Page 0 also carries
 * the small things; later pages carry events only.
 */
export interface PushPage {
  readonly protocolVersion: number
  readonly pushId: string
  readonly clientNow: number
  readonly deviceId: string
  readonly page: number
  readonly lastPage: boolean
  readonly events: readonly ReviewEvent[]
  readonly dayComplete: readonly WireDayComplete[]
  readonly documents: readonly DocumentWrite[]
}

export type PushResponse =
  | {
      readonly status: 'ok'
      /** The server's copy of every document the page wrote, accepted or merged. */
      readonly documents: readonly WireDocument[]
      readonly rejected: readonly DocumentRejection[]
    }
  | { readonly status: 'upgrade_required'; readonly minProtocolVersion: number }

export interface PullRequest {
  readonly protocolVersion: number
  readonly deviceId: string
  /** Documents with a version above this are returned; 0 for everything. */
  readonly documentsSince: number
}

export type PullResponse =
  | {
      readonly status: 'ok'
      readonly serverNow: number
      readonly schedulerVersion: string
      /** The whole derived state: a new device is ready after one pull (spec §9.2). */
      readonly reviewStates: readonly ReviewState[]
      /** Per device, the highest deviceSeq the state includes (spec §4.3). */
      readonly deviceMarks: Readonly<Record<string, number>>
      /** The trailing 90 local days (spec §8.3). */
      readonly summaries: readonly DaySummary[]
      /** Every completed local date, YYYY-MM-DD (spec §8.4). */
      readonly dayComplete: readonly string[]
      readonly documents: readonly WireDocument[]
      /** The high-water mark to send as `documentsSince` next time. */
      readonly documentsVersion: number
      /** Authoritative XP (spec §8.7, §10): lifetime, and today's by UTC day. */
      readonly xp: { readonly total: number; readonly utcDay: number; readonly today: number }
    }
  | { readonly status: 'upgrade_required'; readonly minProtocolVersion: number }
