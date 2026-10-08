import { describe, expect, it } from 'vitest'
import { startUpdateChecks, UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_MIN_GAP_MS, type UpdateCheckDeps } from './updateChecks'

function world(update: () => Promise<unknown> = async () => undefined) {
  let now = 1_000_000
  let updates = 0
  const foreground: (() => void)[] = []
  const intervals: { run: () => void; ms: number }[] = []
  const deps: UpdateCheckDeps = {
    now: () => now,
    onForeground: (listener) => foreground.push(listener),
    setInterval: (run, ms) => intervals.push({ run, ms }),
  }
  const registration = {
    update: () => {
      updates += 1
      return update()
    },
  }
  return {
    deps,
    registration,
    updates: () => updates,
    advance: (ms: number) => (now += ms),
    /** The page became visible, or the device came online. */
    foreground: () => foreground.forEach((f) => f()),
    intervals,
  }
}

describe('looking for a new version (spec §9.1)', () => {
  it('looks when the app returns to the foreground, visible or online', () => {
    const w = world()
    startUpdateChecks(w.registration, w.deps)
    expect(w.updates()).toBe(0)
    w.advance(UPDATE_CHECK_MIN_GAP_MS)
    w.foreground()
    expect(w.updates()).toBe(1)
  })

  it('looks about hourly while the app is open', () => {
    const w = world()
    startUpdateChecks(w.registration, w.deps)
    expect(w.intervals.map((i) => i.ms)).toEqual([UPDATE_CHECK_INTERVAL_MS])
    w.advance(UPDATE_CHECK_INTERVAL_MS)
    w.intervals[0]!.run()
    w.advance(UPDATE_CHECK_INTERVAL_MS)
    w.intervals[0]!.run()
    expect(w.updates()).toBe(2)
  })

  it('never looks twice within a few minutes, however often the app comes forward', () => {
    const w = world()
    const check = startUpdateChecks(w.registration, w.deps)
    // The browser looked when the page loaded.
    w.foreground()
    expect(w.updates()).toBe(0)
    w.advance(UPDATE_CHECK_MIN_GAP_MS)
    w.foreground()
    w.foreground()
    w.advance(UPDATE_CHECK_MIN_GAP_MS - 1)
    w.foreground()
    check()
    expect(w.updates()).toBe(1)
    w.advance(1)
    check()
    expect(w.updates()).toBe(2)
  })

  it('ignores a look that fails, offline, and looks again later', async () => {
    const w = world(() => Promise.reject(new TypeError('offline')))
    startUpdateChecks(w.registration, w.deps)
    w.advance(UPDATE_CHECK_MIN_GAP_MS)
    w.foreground()
    await Promise.resolve()
    w.advance(UPDATE_CHECK_MIN_GAP_MS)
    w.foreground()
    expect(w.updates()).toBe(2)
  })

  it('ignores a registration that throws', () => {
    const w = world(() => {
      throw new Error('gone')
    })
    startUpdateChecks(w.registration, w.deps)
    w.advance(UPDATE_CHECK_MIN_GAP_MS)
    expect(() => w.foreground()).not.toThrow()
  })
})
