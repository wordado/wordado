import type { ChangeL1Outcome, Store } from '@wordado/client-data'
import type { L1 } from '@wordado/core'

interface Watched {
  readonly store: Store<{ readonly l1: string; readonly settings: { readonly l1: L1 | null } }>
}

/**
 * The one place that switches packs (plan 10, Decision 2): when the learner's L1 setting differs from the installed
 * L1 (chosen in Settings, at sign-in, or on another device and synced here), install the other language. One install
 * runs at a time; a change made meanwhile is followed once it is done.
 *
 * A failed install (offline, or a manifest without that pack) is remembered: the same L1 is not tried again on every
 * store change (each answer refreshes the snapshot), only when the device comes back online, when the setting names
 * another L1, or at the next launch.
 */
export function watchL1(client: Watched, install: (l1: L1) => Promise<ChangeL1Outcome>, online: () => boolean, onOnline: (retry: () => void) => () => void): () => void {
  let running = false
  let stopped = false
  let failed: L1 | null = null
  const check = (retry: boolean) => {
    if (stopped || running) return
    const { l1, settings } = client.store.get()
    const target = settings.l1
    if (target === null || target === l1) {
      failed = null
      return
    }
    if ((target === failed && !retry) || !online()) return
    running = true
    void install(target)
      .catch((): ChangeL1Outcome => ({ ok: false, reason: 'unavailable' }))
      .then((outcome) => {
        failed = outcome.ok ? null : target
        running = false
        // The setting may have changed while this install ran.
        check(false)
      })
  }
  check(false)
  const unsubscribe = client.store.subscribe(() => check(false))
  const stopOnline = onOnline(() => check(true))
  return () => {
    stopped = true
    unsubscribe()
    stopOnline()
  }
}
