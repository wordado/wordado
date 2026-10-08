import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../account/storage'
import {
  AppLifecycle,
  AUTO_UPDATE_KEY,
  AUTO_UPDATE_MIN_GAP_MS,
  AUTO_UPDATED_KEY,
  SAFE_POLL_STEPS_MS,
  TAKE_OVER_TIMEOUT_MS,
  watchUpdates,
  type InstallEvent,
  type LifecycleDeps,
  type Timers,
} from './lifecycle'

/** The longest wait between two looks for a safe moment: moving the clock this far always passes one. */
const SAFE_POLL_MS = SAFE_POLL_STEPS_MS.at(-1)!

/** A clock and its timers, moved by the test. */
function fakeClock() {
  let now = 1_000_000
  let next = 1
  const timers = new Map<number, { readonly at: number; readonly run: () => void }>()
  return {
    now: () => now,
    /** Timers set and not yet run or cleared. */
    pending: () => timers.size,
    /** Sets the clock itself, as a learner or the network might: back, too. */
    set: (to: number) => void (now = to),
    timers: {
      set: (run: () => void, ms: number) => {
        timers.set(next, { at: now + ms, run })
        return next++
      },
      clear: (handle: unknown) => void timers.delete(handle as number),
    } satisfies Timers,
    /** Moves the clock on, running each timer that falls due, in order. */
    advance(ms: number) {
      const until = now + ms
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].run()
      }
      now = until
    },
  }
}

function lifecycle(storage = memoryStorage(), session = memoryStorage(), clock = fakeClock(), extra: Partial<LifecycleDeps> = {}) {
  let reloads = 0
  const l = new AppLifecycle({ storage, session, timers: clock.timers, now: clock.now, reload: () => (reloads += 1), ...extra })
  return { l, storage, clock, reloads: () => reloads }
}

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted'): InstallEvent & { prompted: number } {
  const e = {
    prompted: 0,
    prompt: async () => {
      e.prompted += 1
    },
    userChoice: Promise.resolve({ outcome }),
  }
  return e
}

describe('the installation prompt (spec §9.1)', () => {
  it('waits for the second distinct day of use', () => {
    const { l } = lifecycle()
    l.installAvailable(installEvent())
    l.recordVisit('2026-09-24')
    l.recordVisit('2026-09-24')
    expect(l.store.get()).toMatchObject({ installable: 'prompt', installOffer: null })
    l.recordVisit('2026-09-25')
    expect(l.store.get().installOffer).toBe('prompt')
  })

  it('remembers the days across launches', () => {
    const storage = memoryStorage()
    lifecycle(storage).l.recordVisit('2026-09-24')
    const { l } = lifecycle(storage)
    l.iosInstallable()
    l.recordVisit('2026-09-26')
    expect(l.store.get().installOffer).toBe('ios')
  })

  it('shows the browser’s prompt once, then offers nothing', async () => {
    const { l } = lifecycle()
    const event = installEvent()
    l.installAvailable(event)
    l.recordVisit('2026-09-24')
    l.recordVisit('2026-09-25')
    await l.install()
    expect(event.prompted).toBe(1)
    expect(l.store.get()).toMatchObject({ installable: null, installOffer: null })
  })

  it('stays dismissed after "Not now", across launches', () => {
    const storage = memoryStorage()
    const first = lifecycle(storage).l
    first.iosInstallable()
    first.recordVisit('2026-09-24')
    first.recordVisit('2026-09-25')
    first.dismissInstall()
    expect(first.store.get().installOffer).toBeNull()
    const again = lifecycle(storage).l
    again.iosInstallable()
    again.recordVisit('2026-09-27')
    expect(again.store.get()).toMatchObject({ installable: 'ios', installOffer: null })
  })
})

describe('updates (spec §9.1, §4.3)', () => {
  it('offers a waiting version, and moves to it on request', () => {
    const { l, reloads } = lifecycle()
    const posted: unknown[] = []
    l.updateFound({ postMessage: (m) => posted.push(m) })
    expect(l.store.get().updateReady).toBe(true)
    l.applyUpdate()
    expect(posted).toEqual([{ type: 'SKIP_WAITING' }])
    expect(reloads()).toBe(0)
  })

  it('reloads to fetch a newer app when nothing is waiting yet', () => {
    const { l, reloads } = lifecycle()
    l.markAppTooOld()
    expect(l.store.get().appTooOld).toBe(true)
    l.applyUpdate()
    expect(reloads()).toBe(1)
  })

  it('watches a registration: a waiting worker, a newly installed one, and the switch', () => {
    const { l, reloads } = lifecycle()
    l.setAutoUpdate(false)
    const w = registered(l)
    // A controllerchange nobody asked for (another tab's update) must not reload.
    w.fire('controllerchange')
    expect(reloads()).toBe(0)
    w.install()
    expect(l.store.get().updateReady).toBe(true)
    l.applyUpdate()
    w.fire('controllerchange')
    w.fire('controllerchange')
    expect(reloads()).toBe(1)
  })

  it('shows that it is moving to the new version, from the request until the reload', () => {
    const { l, clock } = lifecycle()
    l.setAutoUpdate(false)
    l.updateFound({ postMessage: () => undefined })
    expect(l.store.get().applying).toBe(false)
    l.applyUpdate()
    expect(l.store.get().applying).toBe(true)
    // The worker never takes control: the banner comes back.
    clock.advance(TAKE_OVER_TIMEOUT_MS)
    expect(l.store.get()).toMatchObject({ applying: false, updateReady: true })
  })

  it('reloads at once when asked after another tab already moved to the new version', () => {
    const { l, reloads } = lifecycle()
    l.setAutoUpdate(false)
    const w = registered(l)
    w.install()
    w.fire('controllerchange')
    expect(reloads()).toBe(0)
    l.applyUpdate()
    expect(reloads()).toBe(1)
  })
})

/** A registration and its container as `watchUpdates` uses them, with a worker the test installs. */
function registered(l: AppLifecycle, options: { readonly controller?: unknown; readonly installing?: boolean } = {}) {
  const listeners = new Map<string, (event: { readonly data?: unknown }) => void>()
  const posted: unknown[] = []
  const worker = {
    state: 'installing',
    postMessage: (m: unknown) => void posted.push(m),
    addEventListener: (_: 'statechange', f: () => void) => listeners.set('statechange', f),
  }
  // `installing` is null until a version is found, unless the test says one was found before the page listened.
  const registration = {
    waiting: null,
    installing: options.installing ? worker : (null as typeof worker | null),
    addEventListener: (_: 'updatefound', f: () => void) => listeners.set('updatefound', f),
  }
  const find = () => {
    registration.installing = worker
    fire('updatefound')
  }
  const container = {
    controller: 'controller' in options ? options.controller : {},
    addEventListener: (type: 'controllerchange' | 'message', f: (event: { readonly data?: unknown }) => void) => listeners.set(type, f),
  }
  watchUpdates(registration, container, l)
  const fire = (type: string, data?: unknown) => listeners.get(type)?.({ data })
  return {
    posted,
    fire,
    found: find,
    state: (state: string) => {
      worker.state = state
      fire('statechange')
    },
    /** A new version is found and finishes installing: it waits. */
    install: () => {
      find()
      worker.state = 'installed'
      fire('statechange')
    },
  }
}

describe('the automatic update (spec §9.1)', () => {
  it('is on unless the learner switched it off, on this device', () => {
    const storage = memoryStorage()
    const first = lifecycle(storage).l
    expect(first.store.get().autoUpdate).toBe(true)
    first.setAutoUpdate(false)
    expect(first.store.get().autoUpdate).toBe(false)
    expect(lifecycle(storage).l.store.get().autoUpdate).toBe(false)
    lifecycle(storage).l.setAutoUpdate(true)
    expect(storage.getItem(AUTO_UPDATE_KEY)).toBeNull()
    expect(lifecycle(storage).l.store.get().autoUpdate).toBe(true)
  })

  it('moves to a waiting version by itself when nothing is in progress, and reloads once', () => {
    const { l, reloads } = lifecycle()
    l.watchSafety(() => true)
    const w = registered(l)
    w.install()
    expect(w.posted).toEqual([{ type: 'SKIP_WAITING' }])
    expect(l.store.get().applying).toBe(true)
    expect(reloads()).toBe(0)
    w.fire('controllerchange')
    w.fire('controllerchange')
    expect(reloads()).toBe(1)
  })

  it('waits while a run is in progress, with the banner, and updates as soon as it ends', () => {
    const { l, reloads, clock } = lifecycle()
    let studying = true
    l.watchSafety(() => !studying)
    const w = registered(l)
    w.install()
    clock.advance(10 * SAFE_POLL_MS)
    expect(w.posted).toEqual([])
    expect(l.store.get()).toMatchObject({ updateReady: true, applying: false })
    studying = false
    clock.advance(SAFE_POLL_MS)
    expect(w.posted).toEqual([{ type: 'SKIP_WAITING' }])
    w.fire('controllerchange')
    expect(reloads()).toBe(1)
  })

  it('looks again at once when the shell says the screen changed', () => {
    const { l } = lifecycle()
    l.watchSafety(() => false)
    const w = registered(l)
    w.install()
    expect(w.posted).toEqual([])
    l.watchSafety(() => true)
    expect(w.posted).toEqual([{ type: 'SKIP_WAITING' }])
  })

  it('is never safe before the shell is up, after it is gone, or while work is in flight', () => {
    const { l, clock } = lifecycle()
    const w = registered(l)
    w.install()
    clock.advance(SAFE_POLL_MS)
    expect(w.posted).toEqual([])
    const release = l.hold()
    const stop = l.watchSafety(() => true)
    expect(w.posted).toEqual([])
    stop()
    release()
    release()
    expect(w.posted).toEqual([])
    l.watchSafety(() => true)
    expect(w.posted).toEqual([{ type: 'SKIP_WAITING' }])
  })

  it('does nothing by itself with the setting off: the banner and the button, as before', () => {
    const { l, reloads, clock } = lifecycle()
    l.setAutoUpdate(false)
    l.watchSafety(() => true)
    const w = registered(l)
    w.install()
    l.markAppTooOld()
    clock.advance(60 * SAFE_POLL_MS)
    expect(w.posted).toEqual([])
    expect(reloads()).toBe(0)
    expect(l.store.get()).toMatchObject({ updateReady: true, applying: false })
    // Switched back on, the waiting version is moved to.
    l.setAutoUpdate(true)
    expect(w.posted).toEqual([{ type: 'SKIP_WAITING' }])
  })

  it('gives up after one attempt when the new version does not take control, and offers the banner again', () => {
    const session = memoryStorage()
    const { l, reloads, clock } = lifecycle(memoryStorage(), session)
    l.watchSafety(() => true)
    const w = registered(l)
    w.install()
    clock.advance(TAKE_OVER_TIMEOUT_MS)
    expect(l.store.get()).toMatchObject({ applying: false, updateReady: true })
    // Not again, however long the app stays open; and a late switch reloads nothing under the learner.
    l.watchSafety(() => true)
    clock.advance(10 * TAKE_OVER_TIMEOUT_MS)
    w.fire('controllerchange')
    expect(w.posted).toEqual([{ type: 'SKIP_WAITING' }])
    expect(reloads()).toBe(0)
    // Nothing was updated, so the next page says nothing.
    expect(lifecycle(memoryStorage(), session).l.store.get().updated).toBe(false)
    // The learner can still ask: the new version is in control by now, so a reload is the update.
    l.applyUpdate()
    expect(reloads()).toBe(1)
  })

  it('holds the reload when a run began before the new version took control', () => {
    const { l, reloads, clock } = lifecycle()
    let studying = false
    l.watchSafety(() => !studying)
    const w = registered(l)
    w.install()
    studying = true
    w.fire('controllerchange')
    clock.advance(TAKE_OVER_TIMEOUT_MS)
    expect(reloads()).toBe(0)
    // No bar with no end in sight: the banner and its button are back while the reload waits.
    expect(l.store.get()).toMatchObject({ applying: false, updateReady: true })
    studying = false
    clock.advance(SAFE_POLL_MS)
    clock.advance(SAFE_POLL_MS)
    expect(reloads()).toBe(1)
  })

  it('drops a reload it still owes when the learner switches the setting off; the button still updates', () => {
    const { l, reloads, clock } = lifecycle()
    let studying = false
    l.watchSafety(() => !studying)
    const w = registered(l)
    w.install()
    studying = true
    w.fire('controllerchange')
    l.setAutoUpdate(false)
    studying = false
    clock.advance(10 * SAFE_POLL_MS)
    expect(reloads()).toBe(0)
    expect(l.store.get()).toMatchObject({ applying: false, updateReady: true })
    l.applyUpdate()
    expect(reloads()).toBe(1)
  })

  it('lets the learner update at once while the reload waits for the run', () => {
    const { l, reloads, clock } = lifecycle()
    let studying = false
    l.watchSafety(() => !studying)
    const w = registered(l)
    w.install()
    studying = true
    w.fire('controllerchange')
    l.applyUpdate()
    expect(reloads()).toBe(1)
    studying = false
    clock.advance(10 * SAFE_POLL_MS)
    expect(reloads()).toBe(1)
  })

  it('cancels its own request when the learner switches the setting off before the new version takes control', () => {
    const session = memoryStorage()
    const { l, reloads, clock } = lifecycle(memoryStorage(), session)
    l.watchSafety(() => true)
    const w = registered(l)
    w.install()
    expect(l.store.get().applying).toBe(true)
    l.setAutoUpdate(false)
    expect(l.store.get()).toMatchObject({ applying: false, updateReady: true })
    w.fire('controllerchange')
    clock.advance(10 * TAKE_OVER_TIMEOUT_MS)
    expect(reloads()).toBe(0)
    expect(clock.pending()).toBe(0)
    expect(lifecycle(memoryStorage(), session).l.store.get().updated).toBe(false)
  })

  it('asks for a safe moment after 2, 5, 15 and then every 30 seconds, and from the start when the screen changes', () => {
    const { l, clock } = lifecycle()
    const asked: number[] = []
    const start = clock.now()
    const guard = () => {
      asked.push((clock.now() - start) / 1000)
      return false
    }
    l.watchSafety(guard)
    const w = registered(l)
    w.install()
    asked.length = 0
    clock.advance(120_000)
    expect(asked).toEqual([2, 7, 22, 52, 82, 112])
    asked.length = 0
    l.watchSafety(guard)
    clock.advance(8_000)
    expect(asked).toEqual([120, 122, 127])
    expect(w.posted).toEqual([])
  })

  it('does not ask at all where no moment can be safe: no shell, or the shell gone', () => {
    const { l, clock } = lifecycle()
    const w = registered(l)
    w.install()
    expect(clock.pending()).toBe(0)
    const stop = l.watchSafety(() => false)
    expect(clock.pending()).toBe(1)
    stop()
    expect(clock.pending()).toBe(0)
    clock.advance(10 * SAFE_POLL_MS)
    expect(w.posted).toEqual([])
  })

  it('does not ask while the page is hidden, and asks again when it is back', () => {
    let visible = false
    let studying = true
    const { l, clock } = lifecycle(memoryStorage(), memoryStorage(), fakeClock(), { visible: () => visible })
    l.watchSafety(() => !studying)
    const w = registered(l)
    w.install()
    expect(clock.pending()).toBe(0)
    visible = true
    l.becameVisible()
    expect(clock.pending()).toBe(1)
    visible = false
    clock.advance(SAFE_POLL_STEPS_MS[0]!)
    expect(clock.pending()).toBe(0)
    // Back, and the run is over meanwhile.
    studying = false
    visible = true
    l.becameVisible()
    expect(w.posted).toEqual([{ type: 'SKIP_WAITING' }])
  })

  it('reads a clock set back since the last update as time gone by, not as a wait', () => {
    const session = memoryStorage()
    const before = lifecycle(memoryStorage(), session)
    before.l.watchSafety(() => true)
    const first = registered(before.l)
    first.install()
    first.fire('controllerchange')
    const after = lifecycle(memoryStorage(), session, before.clock)
    after.clock.set(after.clock.now() - 24 * 60 * 60_000)
    after.l.watchSafety(() => true)
    const second = registered(after.l)
    second.install()
    expect(second.posted).toEqual([{ type: 'SKIP_WAITING' }])
  })

  it('keeps the ten minutes by the device’s own record where the tab’s storage is refused', () => {
    const refused = {
      getItem: () => null,
      setItem: () => {
        throw new Error('refused')
      },
      removeItem: () => undefined,
    }
    const storage = memoryStorage()
    const before = lifecycle(storage, refused)
    before.l.watchSafety(() => true)
    const first = registered(before.l)
    first.install()
    first.fire('controllerchange')
    expect(before.reloads()).toBe(1)
    const after = lifecycle(storage, refused, before.clock)
    after.l.watchSafety(() => true)
    const second = registered(after.l)
    second.install()
    after.clock.advance(AUTO_UPDATE_MIN_GAP_MS - SAFE_POLL_MS)
    expect(second.posted).toEqual([])
    after.clock.advance(2 * SAFE_POLL_MS)
    expect(second.posted).toEqual([{ type: 'SKIP_WAITING' }])
  })

  it('does not update itself on a reloaded page that finds no mark of its tab: nothing there could stop a loop', () => {
    // Storage that keeps nothing across the reload: each page gets its own.
    const page = () => lifecycle(memoryStorage(), memoryStorage(), fakeClock(), { reloaded: () => true })
    const { l, reloads, clock } = page()
    l.watchSafety(() => true)
    const w = registered(l)
    w.install()
    l.markAppTooOld()
    clock.advance(2 * AUTO_UPDATE_MIN_GAP_MS)
    expect(w.posted).toEqual([])
    expect(reloads()).toBe(0)
    expect(l.store.get().updateReady).toBe(true)
    // A reload in a tab whose storage is kept finds the mark its first page left, and updates as usual.
    const session = memoryStorage()
    lifecycle(memoryStorage(), session)
    expect(session.getItem(AUTO_UPDATED_KEY)).not.toBeNull()
    const kept = lifecycle(memoryStorage(), session, fakeClock(), { reloaded: () => true })
    kept.l.watchSafety(() => true)
    const again = registered(kept.l)
    again.install()
    expect(again.posted).toEqual([{ type: 'SKIP_WAITING' }])
  })

  it('says whether the browser kept the setting, and follows another tab’s change', () => {
    const storage = memoryStorage()
    const { l } = lifecycle(storage)
    expect(l.setAutoUpdate(false)).toBe(true)
    // Another tab switches it back on.
    storage.removeItem(AUTO_UPDATE_KEY)
    l.autoUpdateChanged()
    expect(l.store.get().autoUpdate).toBe(true)
    const refused = {
      getItem: () => null,
      setItem: () => {
        throw new Error('refused')
      },
      removeItem: () => undefined,
    }
    const visit = lifecycle(refused).l
    expect(visit.setAutoUpdate(false)).toBe(false)
    // For this visit it is off all the same.
    expect(visit.store.get().autoUpdate).toBe(false)
  })

  it('says once, after the reload, that Wordado was updated', () => {
    const session = memoryStorage()
    const before = lifecycle(memoryStorage(), session)
    before.l.watchSafety(() => true)
    const w = registered(before.l)
    w.install()
    w.fire('controllerchange')
    expect(before.reloads()).toBe(1)
    const after = lifecycle(memoryStorage(), session).l
    expect(after.store.get().updated).toBe(true)
    after.dismissUpdated()
    expect(after.store.get().updated).toBe(false)
    // Another reload of the tab: not said again.
    expect(lifecycle(memoryStorage(), session).l.store.get().updated).toBe(false)
  })

  it('says nothing after an update the learner asked for', () => {
    const session = memoryStorage()
    const { l } = lifecycle(memoryStorage(), session)
    l.setAutoUpdate(false)
    const w = registered(l)
    w.install()
    l.applyUpdate()
    w.fire('controllerchange')
    expect(lifecycle(memoryStorage(), session).l.store.get().updated).toBe(false)
  })

  it('does not update itself again within minutes of the last time: a server that always has a newer worker cannot loop', () => {
    const session = memoryStorage()
    const before = lifecycle(memoryStorage(), session)
    before.l.watchSafety(() => true)
    const first = registered(before.l)
    first.install()
    first.fire('controllerchange')
    const after = lifecycle(memoryStorage(), session, before.clock)
    after.l.watchSafety(() => true)
    const second = registered(after.l)
    second.install()
    after.clock.advance(AUTO_UPDATE_MIN_GAP_MS - SAFE_POLL_MS)
    expect(second.posted).toEqual([])
    expect(after.l.store.get().updateReady).toBe(true)
    after.clock.advance(2 * SAFE_POLL_MS)
    expect(second.posted).toEqual([{ type: 'SKIP_WAITING' }])
  })

  it('asks for a look at once when a newer app is needed, and moves to it when it is ready', () => {
    const { l, reloads } = lifecycle()
    l.watchSafety(() => true)
    const w = registered(l)
    let looks = 0
    l.attachChecker(() => (looks += 1))
    l.markAppTooOld()
    l.markAppTooOld()
    expect(looks).toBe(1)
    // A reload now would only bring the same app back from the cache.
    expect(reloads()).toBe(0)
    w.install()
    expect(w.posted).toEqual([{ type: 'SKIP_WAITING' }])
  })

  it('reloads for a needed app once per tab where no service worker can bring it, and never loops', () => {
    const session = memoryStorage()
    const before = lifecycle(memoryStorage(), session)
    before.l.markAppTooOld()
    expect(before.reloads()).toBe(0)
    before.l.watchSafety(() => true)
    expect(before.reloads()).toBe(1)
    // The reloaded page is still too old: the banner, no second reload, and nothing claimed.
    const after = lifecycle(memoryStorage(), session, before.clock)
    after.l.watchSafety(() => true)
    after.l.markAppTooOld()
    after.clock.advance(2 * AUTO_UPDATE_MIN_GAP_MS)
    expect(after.reloads()).toBe(0)
    expect(after.l.store.get()).toMatchObject({ appTooOld: true, updated: false })
  })
})

describe('a new version’s download (spec §9.1)', () => {
  it('follows what the installing worker reports, until the version is ready', () => {
    const { l } = lifecycle()
    l.setAutoUpdate(false)
    const w = registered(l)
    w.fire('message', { type: 'PRECACHE_PROGRESS', done: 1, total: 4 })
    expect(l.store.get().download).toBeNull()
    w.found()
    expect(l.store.get().download).toEqual({ done: 0, total: 0 })
    w.fire('message', { type: 'PRECACHE_PROGRESS', done: 1, total: 4 })
    w.fire('message', { type: 'SOMETHING_ELSE', done: 3, total: 4 })
    expect(l.store.get().download).toEqual({ done: 1, total: 4 })
    w.state('installed')
    expect(l.store.get()).toMatchObject({ download: null, updateReady: true })
  })

  it('follows a version that was already installing when the page began to listen', () => {
    const { l } = lifecycle()
    l.setAutoUpdate(false)
    const w = registered(l, { installing: true })
    expect(l.store.get().download).toEqual({ done: 0, total: 0 })
    w.fire('message', { type: 'PRECACHE_PROGRESS', done: 3, total: 4 })
    expect(l.store.get().download).toEqual({ done: 3, total: 4 })
    w.state('installed')
    expect(l.store.get()).toMatchObject({ download: null, updateReady: true })
  })

  it('ends with a download that fails', () => {
    const { l } = lifecycle()
    const w = registered(l)
    w.found()
    w.state('redundant')
    expect(l.store.get()).toMatchObject({ download: null, updateReady: false })
  })

  it('shows nothing for the first install: the page already has what is being cached', () => {
    const { l } = lifecycle()
    const w = registered(l, { controller: null })
    w.found()
    w.fire('message', { type: 'PRECACHE_PROGRESS', done: 1, total: 4 })
    w.state('installed')
    expect(l.store.get()).toMatchObject({ download: null, updateReady: false })
  })
})
