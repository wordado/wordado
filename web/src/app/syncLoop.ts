import type { Store, SyncOutcome, SyncStatus } from '@wordado/client-data'

/** How often a visible app syncs on its own. Tuning (§15). */
export const SYNC_INTERVAL_MS = 5 * 60_000

/** What the loop needs of a Client. */
export interface SyncLoopTarget {
  readonly store: Store<{ readonly sync: SyncStatus }>
  sync(options?: { force?: boolean }): Promise<SyncOutcome>
}

export interface SyncLoopOptions {
  /** The in-memory fallback: nothing survives the tab, so each answer goes at once (spec §9.1). */
  readonly everyAnswer: boolean
  readonly now: () => number
  readonly window?: Window
  readonly document?: Document
}

/**
 * When a learner's Client syncs (spec §9.1, §9.2). What a sync does is
 * `client-data`'s. Here: at start; on `online`, past any backoff; when the
 * page is hidden, so an evicted or closed tab has flushed; when it is shown
 * again; every five minutes while visible; when the engine's backoff ends;
 * and on the in-memory fallback, after every answer. Returns `stop`.
 */
export function startSyncLoop(target: SyncLoopTarget, options: SyncLoopOptions): () => void {
  const win = options.window ?? window
  const doc = options.document ?? document
  let stopped = false
  const sync = (force = false) => {
    if (!stopped) void target.sync(force ? { force: true } : undefined).catch(() => undefined)
  }
  const onOnline = () => sync(true)
  const onVisibility = () => sync()
  win.addEventListener('online', onOnline)
  doc.addEventListener('visibilitychange', onVisibility)
  const interval = win.setInterval(() => {
    if (doc.visibilityState === 'visible') sync()
  }, SYNC_INTERVAL_MS)

  let retry: ReturnType<typeof win.setTimeout> | null = null
  let last = target.store.get().sync
  const unsubscribe = target.store.subscribe(() => {
    const status = target.store.get().sync
    if (retry !== null) {
      win.clearTimeout(retry)
      retry = null
    }
    if (status.phase === 'idle' && status.nextAttemptAt !== null) {
      retry = win.setTimeout(() => sync(), Math.max(0, status.nextAttemptAt - options.now()))
    } else if (
      options.everyAnswer &&
      status.phase === 'idle' &&
      status.pendingEvents > 0 &&
      (status.pendingEvents !== last.pendingEvents || last.phase !== 'idle')
    ) {
      sync()
    }
    last = status
  })

  sync()
  return () => {
    stopped = true
    win.removeEventListener('online', onOnline)
    doc.removeEventListener('visibilitychange', onVisibility)
    win.clearInterval(interval)
    if (retry !== null) win.clearTimeout(retry)
    unsubscribe()
  }
}
