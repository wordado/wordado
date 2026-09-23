import {
  MAX_PAGE_DAY_COMPLETE,
  MAX_PAGE_DOCUMENTS,
  SYNC_PAGE_SIZE,
  SYNC_PROTOCOL_VERSION,
  type DocumentWrite,
  type PullRequest,
  type PullResponse,
  type PushPage,
  type PushResponse,
  type Rng,
  type WireDayComplete,
} from '@wordado/core'
import type { Database } from './database'
import { applyServerDocument, confirmPushedDocument, dropPendingPatch, pendingDocumentWrites } from './documents'
import type { SqlDriver } from './driver'
import type { ClientEnv } from './env'
import {
  markDayCompletePushed,
  markEventsPushed,
  pendingDayComplete,
  reloadLearner,
  replaceSnapshot,
  unpushedEvents,
  type Learner,
  type LocalEvent,
} from './learner'
import { getMeta, setMeta } from './meta'

/** The network, as the app provides it: a `fetch` wrapper with the session's credentials (plan 6). Throws on failure. */
export interface SyncTransport {
  push(page: PushPage): Promise<PushResponse>
  pull(request: PullRequest): Promise<PullResponse>
}

export interface SyncStatus {
  readonly phase: 'idle' | 'pushing' | 'pulling'
  readonly pendingEvents: number
  readonly lastSyncAt: number | null
  readonly lastError: string | null
  readonly failures: number
  /** When the next unforced attempt may run; null when there is nothing to wait for. */
  readonly nextAttemptAt: number | null
  /** The server refused this build (spec §4.3); the outbox stays until the app is updated. */
  readonly upgradeRequired: boolean
}

export const INITIAL_SYNC_STATUS: SyncStatus = {
  phase: 'idle',
  pendingEvents: 0,
  lastSyncAt: null,
  lastError: null,
  failures: 0,
  nextAttemptAt: null,
  upgradeRequired: false,
}

export type SyncOutcome = 'synced' | 'skipped' | 'failed' | 'upgrade_required'

export const BACKOFF_BASE_MS = 1_000
export const BACKOFF_MAX_MS = 5 * 60_000

/** Doubling from a second to the ceiling, with ×0.5–1.5 jitter so devices do not retry in step. Tuning (§15). */
export function backoffMs(failures: number, rng: Rng): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1)) * (0.5 + rng())
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Authoritative XP as of the last pull (spec §8.7, §10). */
export interface PulledXp {
  readonly total: number
  readonly utcDay: number
  readonly today: number
}

export async function readPulledXp(driver: SqlDriver): Promise<PulledXp | null> {
  const raw = await getMeta(driver, 'xp')
  return raw === null ? null : (JSON.parse(raw) as PulledXp)
}

export interface SyncDeps {
  readonly db: Database
  readonly env: ClientEnv
  readonly learner: Learner
  readonly transport: SyncTransport
}

/**
 * Push, then pull (spec §9.2). One run at a time: concurrent calls share it.
 * After a failure the engine backs off; `force` ignores the backoff, never
 * an upgrade requirement.
 */
export class SyncEngine {
  status: SyncStatus = INITIAL_SYNC_STATUS
  onStatus: ((status: SyncStatus) => void) | null = null
  private running: Promise<SyncOutcome> | null = null

  constructor(private readonly deps: SyncDeps) {}

  private set(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch }
    this.onStatus?.(this.status)
  }

  sync(options: { force?: boolean } = {}): Promise<SyncOutcome> {
    if (this.running) return this.running
    this.running = this.run(options.force ?? false).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(force: boolean): Promise<SyncOutcome> {
    const { env } = this.deps
    if (this.status.upgradeRequired) return 'skipped'
    if (!force && this.status.nextAttemptAt !== null && env.now() < this.status.nextAttemptAt) return 'skipped'
    try {
      this.set({ phase: 'pushing' })
      if ((await this.push()) === 'upgrade_required') return this.upgradeRequired()
      this.set({ phase: 'pulling' })
      if ((await this.pull()) === 'upgrade_required') return this.upgradeRequired()
      this.set({ phase: 'idle', pendingEvents: 0, lastSyncAt: env.now(), lastError: null, failures: 0, nextAttemptAt: null })
      return 'synced'
    } catch (err) {
      const failures = this.status.failures + 1
      this.set({
        phase: 'idle',
        lastError: err instanceof Error ? err.message : String(err),
        failures,
        nextAttemptAt: env.now() + backoffMs(failures, env.rng),
      })
      return 'failed'
    }
  }

  private upgradeRequired(): SyncOutcome {
    this.set({ phase: 'idle', upgradeRequired: true })
    return 'upgrade_required'
  }

  /**
   * Everything pending, in pages the server accepts (spec §9.2): answers
   * `SYNC_PAGE_SIZE` a page and document writes `MAX_PAGE_DOCUMENTS` a page,
   * both from page 0, under one push id and one `clientNow`. Completed days
   * ride on the last page, after every answer, `MAX_PAGE_DAY_COMPLETE` at a
   * time; any beyond that follow in pushes of their own. A page the server
   * would refuse for its size would fail on every retry and wedge the outbox.
   */
  private async push(): Promise<'ok' | 'upgrade_required'> {
    const { db } = this.deps
    const events = await unpushedEvents(db.driver)
    const dayComplete = await pendingDayComplete(db.driver)
    const documents = await pendingDocumentWrites(db.driver)
    this.set({ pendingEvents: events.length })
    if (events.length === 0 && dayComplete.length === 0 && documents.length === 0) return 'ok'
    const dayChunks = chunk(dayComplete, MAX_PAGE_DAY_COMPLETE)
    if ((await this.pushOnce(events, documents, dayChunks[0] ?? [])) === 'upgrade_required') return 'upgrade_required'
    for (const days of dayChunks.slice(1)) if ((await this.pushOnce([], [], days)) === 'upgrade_required') return 'upgrade_required'
    return 'ok'
  }

  private async pushOnce(events: readonly LocalEvent[], documents: readonly DocumentWrite[], dayComplete: readonly WireDayComplete[]): Promise<'ok' | 'upgrade_required'> {
    const { db, env, learner, transport } = this.deps
    const pushId = env.uuid()
    const clientNow = env.now()
    const eventPages = chunk(events, SYNC_PAGE_SIZE)
    const documentPages = chunk(documents, MAX_PAGE_DOCUMENTS)
    const pageCount = Math.max(1, eventPages.length, documentPages.length)
    for (let page = 0; page < pageCount; page += 1) {
      const slice = eventPages[page] ?? []
      const writes = documentPages[page] ?? []
      const lastPage = page === pageCount - 1
      const response = await transport.push({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        pushId,
        clientNow,
        deviceId: learner.deviceId,
        page,
        lastPage,
        events: slice.map(({ pushed: _pushed, ...event }) => event),
        // Completed days ride on the last page: the server accepts one only once the
        // log holds an answer on that date, and the answers arrive in sequence order.
        dayComplete: lastPage ? dayComplete : [],
        documents: writes,
      })
      if (response.status === 'upgrade_required') return 'upgrade_required'
      const pushedIds = new Set(slice.map((e) => e.reviewId))
      await db.transaction(async (tx) => {
        await markEventsPushed(tx, slice.map((e) => e.reviewId))
        learner.localEvents = learner.localEvents.map((e) => (pushedIds.has(e.reviewId) ? { ...e, pushed: true } : e))
        if (lastPage) await markDayCompletePushed(tx, dayComplete.map((d) => d.localDate))
        for (const doc of response.documents) {
          const sent = writes.find((w) => w.type === doc.type && w.key === doc.key)
          if (sent) await confirmPushedDocument(tx, doc, sent.patch)
        }
        for (const r of response.rejected) await dropPendingPatch(tx, r.type, r.key)
        // A rejected write leaves optimistic fields behind and bumps no server version,
        // so the cursor is reset: the next pull returns every document and overwrites them.
        if (response.rejected.length > 0) await setMeta(tx, 'documents_since', '0')
      })
      this.set({ pendingEvents: Math.max(0, events.length - (page + 1) * SYNC_PAGE_SIZE) })
    }
    return 'ok'
  }

  private async pull(): Promise<'ok' | 'upgrade_required'> {
    const { db, env, learner, transport } = this.deps
    const documentsSince = Number((await getMeta(db.driver, 'documents_since')) ?? '0')
    const response = await transport.pull({ protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: learner.deviceId, documentsSince })
    if (response.status === 'upgrade_required') return 'upgrade_required'
    await db.transaction(async (tx) => {
      await replaceSnapshot(tx, {
        states: response.reviewStates,
        marks: response.deviceMarks,
        summaries: response.summaries,
        dayComplete: response.dayComplete,
      })
      for (const doc of response.documents) await applyServerDocument(tx, doc)
      await setMeta(tx, 'documents_since', String(response.documentsVersion))
      await setMeta(tx, 'xp', JSON.stringify(response.xp))
      await setMeta(tx, 'last_pull_at', String(env.now()))
    })
    await reloadLearner(db, learner)
    return 'ok'
  }
}
