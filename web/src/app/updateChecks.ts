/** How often an open app looks for a new version (spec §9.1). Tuning (§15). */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60_000
/** Never more often than this, however often the app comes back to the foreground. */
export const UPDATE_CHECK_MIN_GAP_MS = 5 * 60_000

export interface UpdateCheckDeps {
  now(): number
  /** Calls `listener` whenever the app returns to the foreground: the page becomes visible, or the device comes online. */
  onForeground(listener: () => void): void
  setInterval(run: () => void, ms: number): unknown
}

/** The browser's own: `visibilitychange` to visible, `online`, and its clock and timer. */
export const browserUpdateCheckDeps: UpdateCheckDeps = {
  now: () => Date.now(),
  onForeground: (listener) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') listener()
    })
    window.addEventListener('online', listener)
  },
  setInterval: (run, ms) => setInterval(run, ms),
}

/**
 * Looks for a new version more often than the browser does by itself (spec
 * §9.1): when the app returns to the foreground and about hourly while it is
 * open, never within `UPDATE_CHECK_MIN_GAP_MS` of the last look (the browser
 * looked when the page loaded). A failed look (offline) is nothing. Returns
 * the check itself, for when a newer app is known to be needed.
 */
export function startUpdateChecks(registration: { update(): Promise<unknown> }, deps: UpdateCheckDeps = browserUpdateCheckDeps): () => void {
  let last = deps.now()
  const check = () => {
    const now = deps.now()
    if (now - last < UPDATE_CHECK_MIN_GAP_MS) return
    last = now
    try {
      void registration.update().catch(() => undefined)
    } catch {
      // A registration that is gone: nothing to update.
    }
  }
  deps.onForeground(check)
  deps.setInterval(check, UPDATE_CHECK_INTERVAL_MS)
  return check
}
