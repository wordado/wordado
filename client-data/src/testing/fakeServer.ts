import {
  applyPatch,
  classifyEvents,
  computeXp,
  createDocument,
  dayToIsoDate,
  localDay,
  mergeUnlockSets,
  openPushWindow,
  replay,
  SCHEDULER_VERSION,
  stampEvents,
  summarizeDays,
  utcDay,
  type DeviceMark,
  type DocumentRejection,
  type PullRequest,
  type PullResponse,
  type PushPage,
  type PushResponse,
  type PushWindow,
  type StampCarry,
  type StampedReviewEvent,
  type WireDocument,
} from '@wordado/core'
import type { SyncTransport } from '../sync'

export interface FakeServerOptions {
  now(): number
  readonly accountCreatedAt?: number
  readonly minProtocolVersion?: number
}

/** Document types the server owns, whatever exists yet (spec §8.8, §9.2; plan 2 contract: per type, not per write). */
export const SERVER_OWNED_TYPES: ReadonlySet<string> = new Set(['entitlement'])

const unitsOf = (fields: Record<string, unknown>): string[] =>
  Array.isArray(fields['units']) ? (fields['units'] as unknown[]).filter((u): u is string => typeof u === 'string') : []

/**
 * The sync endpoints as `core`'s rules define them (spec §9.2, §4.3, §8.4,
 * §10): what plan 5's server must do, executable. One user, in memory.
 * Left to the real server: expiring a push window after its last page, and
 * trimming the pulled summary to the trailing 90 days.
 */
export class FakeServer implements SyncTransport {
  readonly events = new Map<string, StampedReviewEvent>()
  readonly devices = new Map<string, DeviceMark>()
  readonly dayComplete = new Set<string>()
  readonly documents = new Map<string, WireDocument>()
  readonly pushes: PushPage[] = []
  private readonly windows = new Map<string, { window: PushWindow; carry: StampCarry }>()
  private documentVersion = 0
  /** Thrown by the next call before it does anything: a network failure. */
  failNext: Error | null = null
  /** The next push is applied, then the response is lost: a retry must be idempotent. */
  failAfterNext = false
  /** The next push page with this index fails before it is applied: a backlog split across pushes. */
  failOnPushPage: number | null = null
  minProtocolVersion: number

  constructor(private readonly options: FakeServerOptions) {
    this.minProtocolVersion = options.minProtocolVersion ?? 1
  }

  private maybeFail(): void {
    if (this.failNext) {
      const err = this.failNext
      this.failNext = null
      throw err
    }
  }

  /**
   * The date of an answer is the client's local date at the moment it was
   * given (spec §8.4): `clientTs` with its offset, which is what the client
   * used, and which a clock correction does not move across midnight.
   */
  private hasAnswerOn(localDate: string): boolean {
    for (const e of this.events.values()) {
      if (dayToIsoDate(localDay(e.clientTs, e.clientTzOffsetMin)) === localDate) return true
    }
    return false
  }

  async push(page: PushPage): Promise<PushResponse> {
    this.maybeFail()
    if (this.failOnPushPage === page.page) {
      this.failOnPushPage = null
      throw new Error(`connection lost before page ${page.page}`)
    }
    this.pushes.push(page)
    if (page.protocolVersion < this.minProtocolVersion) return { status: 'upgrade_required', minProtocolVersion: this.minProtocolVersion }
    const serverNow = this.options.now()
    let entry = this.windows.get(page.pushId)
    if (!entry) {
      const window = openPushWindow({
        clientNow: page.clientNow,
        serverNow,
        lastAccepted: this.devices.get(page.deviceId) ?? null,
        accountCreatedAt: this.options.accountCreatedAt ?? 0,
      })
      entry = { window, carry: new Map() }
      this.windows.set(page.pushId, entry)
    }
    const fresh = page.events.filter((e) => !this.events.has(e.reviewId))
    const { events, carry } = stampEvents(fresh, entry.window, serverNow, entry.carry)
    entry.carry = carry
    for (const e of events) {
      this.events.set(e.reviewId, e)
      const mark = this.devices.get(e.deviceId)
      if (!mark || e.deviceSeq > mark.deviceSeq) this.devices.set(e.deviceId, { deviceSeq: e.deviceSeq, effectiveTs: e.effectiveTs })
    }
    // Evaluated on the last page, once every answer of the push is in the log.
    if (page.lastPage) for (const d of page.dayComplete) if (this.hasAnswerOn(d.localDate)) this.dayComplete.add(d.localDate)
    const documents: WireDocument[] = []
    const rejected: DocumentRejection[] = []
    for (const write of page.documents) {
      const id = `${write.type}/${write.key}`
      const existing = this.documents.get(id)
      if (SERVER_OWNED_TYPES.has(write.type) || existing?.class === 'server_owned') {
        rejected.push({ type: write.type, key: write.key, reason: 'server_owned' })
        continue
      }
      const current = existing
        ? { version: existing.version, fields: existing.fields, fieldVersions: existing.fieldVersions, deleted: existing.deleted }
        : createDocument<Record<string, unknown>>({}, 0)
      const patch =
        write.type === 'unit_unlock'
          ? { ...write.patch, fields: { units: [...mergeUnlockSets(unitsOf(current.fields), unitsOf(write.patch.fields))].sort() } }
          : write.patch
      const result = applyPatch(current, patch, this.documentVersion + 1)
      if (!result.accepted) {
        rejected.push({ type: write.type, key: write.key, reason: result.reason })
        continue
      }
      this.documentVersion += 1
      const doc: WireDocument = {
        type: write.type,
        key: write.key,
        class: 'versioned',
        version: result.document.version,
        fields: result.document.fields,
        fieldVersions: result.document.fieldVersions as Record<string, number>,
        deleted: result.document.deleted,
        staleAfter: null,
      }
      this.documents.set(id, doc)
      documents.push(doc)
    }
    if (this.failAfterNext) {
      this.failAfterNext = false
      throw new Error('connection lost after the server applied the push')
    }
    return { status: 'ok', documents, rejected }
  }

  async pull(request: PullRequest): Promise<PullResponse> {
    this.maybeFail()
    if (request.protocolVersion < this.minProtocolVersion) return { status: 'upgrade_required', minProtocolVersion: this.minProtocolVersion }
    const all = [...this.events.values()]
    const now = this.options.now()
    const xp = computeXp(all)
    const today = utcDay(now)
    const deviceMarks: Record<string, number> = {}
    for (const [deviceId, mark] of this.devices) deviceMarks[deviceId] = mark.deviceSeq
    return {
      status: 'ok',
      serverNow: now,
      schedulerVersion: SCHEDULER_VERSION,
      reviewStates: [...replay(all).values()],
      deviceMarks,
      summaries: [...summarizeDays(classifyEvents(all)).values()],
      dayComplete: [...this.dayComplete].sort(),
      documents: [...this.documents.values()].filter((d) => d.version > request.documentsSince),
      documentsVersion: this.documentVersion,
      xp: { total: xp.total, utcDay: today, today: xp.byUtcDay.get(today) ?? 0 },
    }
  }

  /** Writes a server-owned document as the server would (spec §8.8, §9.2). */
  setServerOwned(type: string, key: string, fields: Record<string, unknown>, staleAfter: number): WireDocument {
    this.documentVersion += 1
    const doc: WireDocument = { type, key, class: 'server_owned', version: this.documentVersion, fields, fieldVersions: {}, deleted: false, staleAfter }
    this.documents.set(`${type}/${key}`, doc)
    return doc
  }
}
