import { createStore, type Store } from '@wordado/client-data'
import { memoryStorage, type KeyValue } from '../account/storage'
import { isPrecacheProgress } from './precacheProgress'

/** Distinct days of use (the first two), and whether the install offer was declined. */
export const VISITS_KEY = 'wordado.visits'
/** "Update automatically", per device: `off` once the learner switched it off; absent means on (spec §9.1). */
export const AUTO_UPDATE_KEY = 'wordado.autoUpdate'
/** This tab's last automatic update, kept across its reload (session storage): when, and whether it was said. */
export const AUTO_UPDATED_KEY = 'wordado.autoUpdated'

/** How soon a waiting automatic update asks again whether the moment is safe: sooner at first, then every half minute. */
export const SAFE_POLL_STEPS_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000]
/** This device's last automatic update, beside the tab's own mark: a second witness where a tab's storage is refused. */
export const AUTO_UPDATED_AT_KEY = 'wordado.autoUpdatedAt'
/** How long the waiting version has to take control before the app gives up and offers the banner again. Tuning (§15). */
export const TAKE_OVER_TIMEOUT_MS = 20_000
/** The least time between two automatic updates in one tab, so a server that always has a newer worker cannot loop. */
export const AUTO_UPDATE_MIN_GAP_MS = 10 * 60_000

/** Timers the tests replace. */
export interface Timers {
  set(run: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) }

export interface LifecycleState {
  /** A new version's service worker is installed and waiting. */
  readonly updateReady: boolean
  /** A pack or the server needs a newer app (spec §4.3, §9.3). */
  readonly appTooOld: boolean
  /** "Update automatically" (spec §9.1): on unless the learner switched it off on this device. */
  readonly autoUpdate: boolean
  /** Moving to the waiting version: from the request until the page reloads. */
  readonly applying: boolean
  /** A new version is downloading: the files its worker has cached of those it lists (`total` 0 until it says). */
  readonly download: { readonly done: number; readonly total: number } | null
  /** The app updated itself just before this page loaded; said once. */
  readonly updated: boolean
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

interface AutoMark {
  readonly at: number
  /** "Wordado was updated." has been shown. */
  readonly said: boolean
  /** The update was a plain reload (no service worker to bring it): tried once in this tab, never again. */
  readonly reloaded: boolean
}

export interface LifecycleDeps {
  readonly storage: KeyValue
  reload(): void
  /** This tab's storage, which outlives a reload: page-lifetime storage when left out. */
  readonly session?: KeyValue
  readonly timers?: Timers
  now?(): number
  /** Whether the page is on screen; a hidden page does not poll. Visible when left out. */
  visible?(): boolean
  /** Whether this page was loaded by a reload (the navigation's type). */
  reloaded?(): boolean
}

/** Installation and updates (spec §9.1): what the banners and settings offer. */
export class AppLifecycle {
  readonly store: Store<LifecycleState>
  private waiting: { postMessage(message: unknown): void } | null = null
  private deferred: InstallEvent | null = null
  /** Set once an update was asked for, by the learner or automatically: only then does a controller change reload the page. */
  updateRequested = false
  private readonly session: KeyValue
  private readonly timers: Timers
  /** Says whether a reload would cost the learner nothing right now; null until the shell is up (never safe). */
  private guard: (() => boolean) | null = null
  /** Work in flight that a reload would cut short (an export, a download the learner asked for). */
  private holds = 0
  /** The request under way is the app's own, not the learner's. */
  private auto = false
  /** One automatic attempt per page: a second would be a loop. */
  private autoTried = false
  /** The new version took control during something a reload would interrupt: the reload waits for a safe moment. */
  private reloadOwed = false
  private reloaded = false
  /** The service worker in control changed since the waiting version was found: that version is the one in control. */
  private switched = false
  private poll: unknown = null
  /** How many polls found the moment unsafe since the screen last changed: the next waits longer. */
  private polls = 0
  /**
   * This page came from a reload and found no mark of its tab: the tab's storage does not outlive a reload (or is
   * refused), so nothing could stop a loop. No automatic update on this page; the banner serves.
   */
  private readonly unmarked: boolean
  private takeOver: unknown = null
  /** Looks for a newer version at once (the update checks); null without a service worker. */
  private checker: (() => void) | null = null

  constructor(private readonly deps: LifecycleDeps) {
    this.session = deps.session ?? memoryStorage()
    this.timers = deps.timers ?? realTimers
    const mark = this.mark()
    this.unmarked = mark === null && deps.reloaded?.() === true
    // Every tab leaves a mark at its first page, so a later page without one knows its storage was not kept.
    if (mark === null) this.saveMark({ at: 0, said: true, reloaded: false })
    else if (!mark.said) this.saveMark({ ...mark, said: true })
    this.store = createStore<LifecycleState>({
      updateReady: false,
      appTooOld: false,
      autoUpdate: this.readAutoUpdate(),
      applying: false,
      download: null,
      updated: mark !== null && !mark.said,
      installable: null,
      installOffer: null,
    })
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private readAutoUpdate(): boolean {
    try {
      return this.deps.storage.getItem(AUTO_UPDATE_KEY) !== 'off'
    } catch {
      return true
    }
  }

  private mark(): AutoMark | null {
    try {
      const raw = this.session.getItem(AUTO_UPDATED_KEY)
      const m = raw === null ? null : (JSON.parse(raw) as Partial<AutoMark> | null)
      return m && typeof m.at === 'number' ? { at: m.at, said: m.said === true, reloaded: m.reloaded === true } : null
    } catch {
      return null
    }
  }

  private saveMark(mark: AutoMark): void {
    try {
      this.session.setItem(AUTO_UPDATED_KEY, JSON.stringify(mark))
    } catch {
      // Refused storage: the update still happens; it is only not announced after the reload.
    }
  }

  /** When this tab, or failing its storage this device, last updated itself; 0 for never. */
  private lastAuto(): number {
    let device = 0
    try {
      device = Number(this.deps.storage.getItem(AUTO_UPDATED_AT_KEY)) || 0
    } catch {
      // Refused storage: the tab's own mark is all there is.
    }
    return Math.max(this.mark()?.at ?? 0, device)
  }

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
    this.switched = false
    this.polls = 0
    this.set({ updateReady: true, download: null })
    this.consider()
  }

  markAppTooOld(): void {
    if (this.store.get().appTooOld) return
    this.set({ appTooOld: true })
    // The version that is needed may not have been looked for yet.
    if (!this.waiting) this.checker?.()
    this.consider()
  }

  /** Moves to the waiting version; with none waiting, reloads, which fetches the newest app. */
  applyUpdate(): void {
    this.updateRequested = true
    this.auto = false
    this.request()
  }

  private request(): void {
    // With nothing waiting, or with the new version already in control (another tab moved to it), a reload is the update.
    if (!this.waiting) return this.reloadPage()
    if (this.switched) return this.reloadOnce()
    this.waiting.postMessage({ type: 'SKIP_WAITING' })
    this.set({ applying: true })
    this.timers.clear(this.takeOver)
    this.takeOver = this.timers.set(() => this.gaveUp(), TAKE_OVER_TIMEOUT_MS)
  }

  /** The waiting version never took control: the banner offers the update again, and nothing is tried twice. */
  private gaveUp(): void {
    this.takeOver = null
    if (this.auto) {
      // An automatic request that lapsed must not reload whenever the worker does switch, perhaps under a session.
      this.updateRequested = false
      this.auto = false
      const mark = this.mark()
      if (mark) this.saveMark({ ...mark, said: true })
    }
    this.set({ applying: false })
  }

  /** The service worker in control changed: reload once if an update was asked for, at a safe moment if nobody asked. */
  controllerChanged(): void {
    this.switched = true
    if (!this.updateRequested || this.reloaded || this.reloadOwed) return
    this.timers.clear(this.takeOver)
    this.takeOver = null
    if (this.auto && !this.safe()) {
      // The reload waits for the run to be left; meanwhile the banner and its button, not a bar with no end in sight.
      this.reloadOwed = true
      this.polls = 0
      this.set({ applying: false })
      this.consider()
      return
    }
    this.reloadOnce()
  }

  private reloadOnce(): void {
    if (this.reloaded) return
    this.reloaded = true
    this.reloadOwed = false
    this.reloadPage()
  }

  reloadPage(): void {
    this.deps.reload()
  }

  /**
   * Switches "Update automatically" on or off, on this device (spec §9.1). False when the browser would not keep
   * the choice: it then lasts for this visit.
   */
  setAutoUpdate(on: boolean): boolean {
    let kept = true
    try {
      if (on) this.deps.storage.removeItem(AUTO_UPDATE_KEY)
      else this.deps.storage.setItem(AUTO_UPDATE_KEY, 'off')
      kept = (this.deps.storage.getItem(AUTO_UPDATE_KEY) !== 'off') === on
    } catch {
      kept = false
    }
    this.autoUpdateIs(on)
    return kept
  }

  /** Another tab changed "Update automatically" (the `storage` event): this one follows. */
  autoUpdateChanged(): void {
    const on = this.readAutoUpdate()
    if (on !== this.store.get().autoUpdate) this.autoUpdateIs(on)
  }

  private autoUpdateIs(on: boolean): void {
    // Switched off with the app's own request under way, or its reload still owed: nothing more happens unasked.
    if (!on && this.auto) {
      this.timers.clear(this.takeOver)
      this.takeOver = null
      this.reloadOwed = false
      this.updateRequested = false
      this.auto = false
      const mark = this.mark()
      if (mark) this.saveMark({ ...mark, said: true })
      this.set({ applying: false })
    }
    this.set({ autoUpdate: on })
    this.consider()
  }

  /**
   * The shell says when a reload is safe (`safeToUpdate`); until it does, and after it stops, none is. It says so
   * again whenever the screen changes, which is also when this looks again without waiting for the next poll.
   */
  watchSafety(guard: () => boolean): () => void {
    this.guard = guard
    this.polls = 0
    this.consider()
    return () => {
      if (this.guard !== guard) return
      this.guard = null
      this.consider()
    }
  }

  /** The page came back on screen: the poll it paused while hidden starts again. */
  becameVisible(): void {
    this.polls = 0
    this.consider()
  }

  /** Something that a reload would cut short has begun; call the result when it is over. */
  hold(): () => void {
    this.holds += 1
    let held = true
    return () => {
      if (!held) return
      held = false
      this.holds -= 1
      this.consider()
    }
  }

  private safe(): boolean {
    try {
      return this.holds === 0 && this.guard !== null && this.guard()
    } catch {
      return false
    }
  }

  /**
   * The automatic update (spec §9.1): with the setting on, a version that is ready is moved to as soon as nothing is
   * in progress, once per page; while something is, this asks again, after 2, 5, 15 and then every 30 seconds
   * (`SAFE_POLL_STEPS_MS`), from the start whenever the screen changes. The banner stays meanwhile. Nothing is asked
   * where no moment can be safe (no shell: open in another tab, or failed to open) or while the page is hidden.
   */
  private consider(): void {
    this.timers.clear(this.poll)
    this.poll = null
    const wait = () => {
      if (this.guard === null || this.deps.visible?.() === false) return
      const ms = SAFE_POLL_STEPS_MS[Math.min(this.polls, SAFE_POLL_STEPS_MS.length - 1)]!
      this.polls += 1
      this.poll = this.timers.set(() => this.consider(), ms)
    }
    if (this.reloadOwed) return this.safe() ? this.reloadOnce() : wait()
    const state = this.store.get()
    if (!state.autoUpdate || this.autoTried || this.updateRequested || this.unmarked) return
    const mark = this.mark()
    const ready = state.updateReady && this.waiting !== null
    // With no service worker to bring the newer app, only a reload can; a reload under one would bring the same app.
    const reloadOnly = !ready && state.appTooOld && this.checker === null && !mark?.reloaded
    if (!ready && !reloadOnly) return
    // A clock set back since the last update reads as time gone by, not as ten minutes still to wait.
    const since = this.now() - this.lastAuto()
    if (!this.safe() || (ready && since >= 0 && since < AUTO_UPDATE_MIN_GAP_MS)) return wait()
    this.autoTried = true
    this.auto = true
    this.updateRequested = true
    const at = this.now()
    this.saveMark({ at, said: !ready, reloaded: !ready || mark?.reloaded === true })
    try {
      this.deps.storage.setItem(AUTO_UPDATED_AT_KEY, String(at))
    } catch {
      // Refused storage: the tab's own mark is the witness.
    }
    this.request()
  }

  /** The update checks, once a service worker is registered: asked at once when a newer app is needed. */
  attachChecker(check: () => void): void {
    this.checker = check
  }

  /** A new version began downloading (its worker is installing). */
  downloadStarted(): void {
    this.set({ download: { done: 0, total: 0 } })
  }

  /** What the installing worker says it has cached (`PRECACHE_PROGRESS`); ignored unless a download is on. */
  downloadProgress(done: number, total: number): void {
    if (this.store.get().download !== null) this.set({ download: { done: Math.min(done, total), total } })
  }

  /** The download failed or was replaced. */
  downloadEnded(): void {
    if (this.store.get().download !== null) this.set({ download: null })
  }

  /** "Wordado was updated." was read. */
  dismissUpdated(): void {
    this.set({ updated: false })
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

/** What the banners, the settings and the shell use; their tests pass a fake. */
export type LifecyclePort = Pick<
  AppLifecycle,
  'store' | 'applyUpdate' | 'install' | 'dismissInstall' | 'setAutoUpdate' | 'dismissUpdated' | 'markAppTooOld' | 'watchSafety' | 'hold'
>

interface WorkerLike {
  state: string
  postMessage(message: unknown): void
  addEventListener(type: 'statechange', listener: () => void): void
}

/**
 * Follows the service worker (spec §9.1): a version already waiting, or one
 * that finishes installing while a page is open, is offered, and its download
 * is shown as its worker reports it; once an update is asked for, by the
 * learner or by the app itself at a safe moment, the new version taking
 * control reloads the page, once. A new worker waits for every old tab by
 * default (6a), so nothing swaps under a session.
 */
export function watchUpdates(
  registration: { readonly waiting: WorkerLike | null; readonly installing: WorkerLike | null; addEventListener(type: 'updatefound', listener: () => void): void },
  container: {
    readonly controller: unknown
    addEventListener(type: 'controllerchange' | 'message', listener: (event: { readonly data?: unknown }) => void): void
  },
  lifecycle: AppLifecycle,
): void {
  const follow = (worker: WorkerLike | null) => {
    // The first install is no update: the page already has everything it is caching.
    if (!worker || !container.controller) return
    lifecycle.downloadStarted()
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && container.controller) lifecycle.updateFound(worker)
      else if (worker.state === 'redundant') lifecycle.downloadEnded()
    })
  }
  if (registration.waiting && container.controller) lifecycle.updateFound(registration.waiting)
  // A version found before this page was listening is still installing: its `updatefound` will not come again.
  else follow(registration.installing)
  registration.addEventListener('updatefound', () => follow(registration.installing))
  container.addEventListener('message', (event) => {
    if (isPrecacheProgress(event.data)) lifecycle.downloadProgress(event.data.done, event.data.total)
  })
  container.addEventListener('controllerchange', () => lifecycle.controllerChanged())
}
