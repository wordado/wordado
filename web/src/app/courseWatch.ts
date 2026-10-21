import type { ChangeL1Outcome, Store } from '@wordado/client-data'
import type { Course, L1, Target } from '@wordado/core'
import { sameCourse } from './packSwitch'

interface Watched {
  readonly store: Store<{ readonly course: Course; readonly settings: { readonly course: Target; readonly l1: L1 | null } }>
}

/**
 * The one place that switches packs (plan 10, Decision 2; spec §8.6): when the learner's course setting (its target
 * and its L1) differs from the installed course (an L1 chosen in Settings, at sign-in, or on another device and synced
 * here; a course switched to, here or there), install the other course. A course whose L1 is not chosen yet waits for
 * its setup. One install runs at a time; a change made meanwhile is followed once it is done.
 *
 * A failed install (offline, or a manifest without that pack) is remembered: the same course is not tried again on
 * every store change (each answer refreshes the snapshot), only when the device comes back online, when the setting
 * names another course, or at the next launch. Until then the installed course stays on screen: the change is pending.
 */
export function watchCourse(
  client: Watched,
  install: (course: Course) => Promise<ChangeL1Outcome>,
  online: () => boolean,
  onOnline: (retry: () => void) => () => void,
): () => void {
  let running = false
  let stopped = false
  let failed: Course | null = null
  /** An online event that arrived while an install ran: honoured once that install settles. */
  let retryOwed = false
  const check = (retry: boolean) => {
    if (stopped) return
    if (running) {
      if (retry) retryOwed = true
      return
    }
    const { course, settings } = client.store.get()
    const wanted: Course | null = settings.l1 === null ? null : { target: settings.course, l1: settings.l1 }
    if (wanted === null || sameCourse(wanted, course)) {
      failed = null
      return
    }
    if ((failed !== null && sameCourse(wanted, failed) && !retry) || !online()) return
    running = true
    void install(wanted)
      .catch((): ChangeL1Outcome => ({ ok: false, reason: 'unavailable' }))
      .then((outcome) => {
        failed = outcome.ok ? null : wanted
        running = false
        const owed = retryOwed
        retryOwed = false
        // The setting may have changed while this install ran, or the device come back online.
        check(owed)
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
