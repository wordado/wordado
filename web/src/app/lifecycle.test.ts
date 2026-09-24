import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../account/storage'
import { AppLifecycle, watchUpdates, type InstallEvent } from './lifecycle'

function lifecycle(storage = memoryStorage()) {
  let reloads = 0
  const l = new AppLifecycle({ storage, reload: () => (reloads += 1) })
  return { l, storage, reloads: () => reloads }
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
    const listeners = new Map<string, () => void>()
    const installing = {
      state: 'installing',
      postMessage: () => undefined,
      addEventListener: (_: 'statechange', f: () => void) => listeners.set('statechange', f),
    }
    const registration = {
      waiting: null,
      installing,
      addEventListener: (_: 'updatefound', f: () => void) => listeners.set('updatefound', f),
    }
    const container = {
      controller: {},
      addEventListener: (_: 'controllerchange', f: () => void) => listeners.set('controllerchange', f),
    }
    watchUpdates(registration, container, l)
    // A controllerchange nobody asked for (the first install) must not reload.
    listeners.get('controllerchange')!()
    expect(reloads()).toBe(0)
    listeners.get('updatefound')!()
    installing.state = 'installed'
    listeners.get('statechange')!()
    expect(l.store.get().updateReady).toBe(true)
    l.applyUpdate()
    listeners.get('controllerchange')!()
    listeners.get('controllerchange')!()
    expect(reloads()).toBe(1)
  })
})
