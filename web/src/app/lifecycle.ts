import { createStore, type Store } from '@wordado/client-data'
import type { KeyValue } from '../account/storage'

/** Distinct days of use (the first two), and whether the install offer was declined. */
export const VISITS_KEY = 'wordado.visits'

export interface LifecycleState {
  /** A new version's service worker is installed and waiting. */
  readonly updateReady: boolean
  /** A pack or the server needs a newer app (spec §4.3, §9.3). */
  readonly appTooOld: boolean
  /** How this browser installs: its own prompt, iOS's Add to Home Screen, or not at all (already installed, or unsupported). */
  readonly installable: 'prompt' | 'ios' | null
  /** `installable`, once the learner has come back a second day and has not declined (spec §9.1). */
  readonly installOffer: 'prompt' | 'ios' | null
}

/** The `beforeinstallprompt` event, as far as the app uses it. */
export interface InstallEvent {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>
}

interface Visits {
  readonly days: readonly string[]
  readonly dismissed: boolean
}

export interface LifecycleDeps {
  readonly storage: KeyValue
  reload(): void
}

/** Installation and updates (spec §9.1): what the banners and settings offer. */
export class AppLifecycle {
  readonly store: Store<LifecycleState> = createStore<LifecycleState>({ updateReady: false, appTooOld: false, installable: null, installOffer: null })
  private waiting: { postMessage(message: unknown): void } | null = null
  private deferred: InstallEvent | null = null
  /** Set once the learner asked to update: only then does a controller change reload the page. */
  updateRequested = false

  constructor(private readonly deps: LifecycleDeps) {}

  private visits(): Visits {
    try {
      const raw = this.deps.storage.getItem(VISITS_KEY)
      const v = raw === null ? null : (JSON.parse(raw) as Partial<Visits>)
      return { days: Array.isArray(v?.days) ? v.days.filter((d): d is string => typeof d === 'string') : [], dismissed: v?.dismissed === true }
    } catch {
      return { days: [], dismissed: false }
    }
  }

  private saveVisits(v: Visits): void {
    try {
      this.deps.storage.setItem(VISITS_KEY, JSON.stringify(v))
    } catch {
      // Refused storage: the prompt then waits for a second day of this page, which never comes. Acceptable.
    }
  }

  private set(patch: Partial<LifecycleState>): void {
    const next = { ...this.store.get(), ...patch }
    const v = this.visits()
    this.store.set({ ...next, installOffer: v.days.length >= 2 && !v.dismissed ? next.installable : null })
  }

  /** Records today (a local date, YYYY-MM-DD); two distinct days are all that is kept. */
  recordVisit(day: string): void {
    const v = this.visits()
    if (!v.days.includes(day) && v.days.length < 2) this.saveVisits({ ...v, days: [...v.days, day] })
    this.set({})
  }

  updateFound(worker: { postMessage(message: unknown): void }): void {
    this.waiting = worker
    this.set({ updateReady: true })
  }

  markAppTooOld(): void {
    this.set({ appTooOld: true })
  }

  /** Moves to the waiting version; with none waiting, reloads, which fetches the newest app. */
  applyUpdate(): void {
    this.updateRequested = true
    if (this.waiting) this.waiting.postMessage({ type: 'SKIP_WAITING' })
    else this.reloadPage()
  }

  reloadPage(): void {
    this.deps.reload()
  }

  installAvailable(event: InstallEvent): void {
    this.deferred = event
    this.set({ installable: 'prompt' })
  }

  iosInstallable(): void {
    if (this.store.get().installable === null) this.set({ installable: 'ios' })
  }

  async install(): Promise<void> {
    const event = this.deferred
    if (!event) return
    this.deferred = null
    await event.prompt()
    await event.userChoice.catch(() => undefined)
    // The browser's prompt is usable once; after it, the browser decides.
    this.set({ installable: null })
  }

  dismissInstall(): void {
    this.saveVisits({ ...this.visits(), dismissed: true })
    this.set({})
  }
}

/** What the banners and settings use; their tests pass a fake. */
export type LifecyclePort = Pick<AppLifecycle, 'store' | 'applyUpdate' | 'install' | 'dismissInstall'>

interface WorkerLike {
  state: string
  postMessage(message: unknown): void
  addEventListener(type: 'statechange', listener: () => void): void
}

/**
 * Follows the service worker (spec §9.1): a version already waiting, or one
 * that finishes installing while a page is open, is offered; once the
 * learner asks to update, the new version taking control reloads the page,
 * once. A new worker waits for every old tab by default (6a), so nothing
 * swaps under a session unless the learner asks.
 */
export function watchUpdates(
  registration: { readonly waiting: WorkerLike | null; readonly installing: WorkerLike | null; addEventListener(type: 'updatefound', listener: () => void): void },
  container: { readonly controller: unknown; addEventListener(type: 'controllerchange', listener: () => void): void },
  lifecycle: AppLifecycle,
  reload: () => void = () => lifecycle.reloadPage(),
): void {
  if (registration.waiting && container.controller) lifecycle.updateFound(registration.waiting)
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && container.controller) lifecycle.updateFound(worker)
    })
  })
  let reloaded = false
  container.addEventListener('controllerchange', () => {
    if (!lifecycle.updateRequested || reloaded) return
    reloaded = true
    reload()
  })
}
