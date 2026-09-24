import { createStore, INITIAL_SYNC_STATUS, type SyncStatus } from '@wordado/client-data'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startSyncLoop, SYNC_INTERVAL_MS, type SyncLoopTarget } from './syncLoop'

function target() {
  const store = createStore<{ readonly sync: SyncStatus }>({ sync: INITIAL_SYNC_STATUS })
  const calls: ({ force?: boolean } | undefined)[] = []
  const t: SyncLoopTarget = {
    store,
    sync: async (options) => {
      calls.push(options)
      return 'synced'
    },
  }
  const status = (patch: Partial<SyncStatus>) => store.set({ sync: { ...store.get().sync, ...patch } })
  return { t, calls, status }
}

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => vi.useRealTimers())

describe('the sync loop (spec §9.1)', () => {
  it('syncs at once, on going online (forced past any backoff), and when the page is hidden', () => {
    const { t, calls } = target()
    const stop = startSyncLoop(t, { everyAnswer: false, now: () => Date.now() })
    expect(calls).toHaveLength(1)
    window.dispatchEvent(new Event('online'))
    expect(calls[1]).toEqual({ force: true })
    setVisibility('hidden')
    expect(calls).toHaveLength(3)
    stop()
  })

  it('syncs every five minutes while visible, and not while hidden', () => {
    const { t, calls } = target()
    const stop = startSyncLoop(t, { everyAnswer: false, now: () => Date.now() })
    vi.advanceTimersByTime(SYNC_INTERVAL_MS)
    expect(calls).toHaveLength(2)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    vi.advanceTimersByTime(SYNC_INTERVAL_MS)
    expect(calls).toHaveLength(2)
    stop()
  })

  it('tries again when the engine’s backoff runs out', () => {
    const { t, calls, status } = target()
    const stop = startSyncLoop(t, { everyAnswer: false, now: () => Date.now() })
    status({ failures: 1, nextAttemptAt: Date.now() + 1_500 })
    vi.advanceTimersByTime(1_499)
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(calls).toHaveLength(2)
    stop()
  })

  it('on the in-memory fallback, syncs after every answer (spec §9.1)', () => {
    const { t, calls, status } = target()
    const stop = startSyncLoop(t, { everyAnswer: true, now: () => Date.now() })
    status({ pendingEvents: 1 })
    expect(calls).toHaveLength(2)
    status({ phase: 'pushing' })
    status({ pendingEvents: 2 })
    expect(calls).toHaveLength(2)
    // The push ends with an answer still waiting: it goes at once.
    status({ phase: 'idle', pendingEvents: 1 })
    expect(calls).toHaveLength(3)
    stop()
  })

  it('does not sync per answer on stored backends', () => {
    const { t, calls, status } = target()
    const stop = startSyncLoop(t, { everyAnswer: false, now: () => Date.now() })
    status({ pendingEvents: 1 })
    expect(calls).toHaveLength(1)
    stop()
  })

  it('stops listening and timing when stopped', () => {
    const { t, calls, status } = target()
    const stop = startSyncLoop(t, { everyAnswer: true, now: () => Date.now() })
    stop()
    window.dispatchEvent(new Event('online'))
    setVisibility('hidden')
    status({ pendingEvents: 3, nextAttemptAt: Date.now() + 10 })
    vi.advanceTimersByTime(SYNC_INTERVAL_MS)
    expect(calls).toHaveLength(1)
  })
})
