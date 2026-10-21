import { createStore } from '@wordado/client-data'
import type { Course } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { watchContentFiles } from './contentFiles'

describe('watchContentFiles', () => {
  it('runs at once, then each time the active corpus version changes, until stopped', () => {
    const store = createStore<{ packVersion: number | null; course: Course }>({ packVersion: 1, course: { target: 'en', l1: 'bg' } })
    let runs = 0
    const stop = watchContentFiles({ store }, () => (runs += 1))
    expect(runs).toBe(1)
    store.set({ packVersion: 1, course: { target: 'en', l1: 'bg' } })
    expect(runs).toBe(1)
    store.set({ packVersion: 2, course: { target: 'en', l1: 'bg' } })
    expect(runs).toBe(2)
    stop()
    store.set({ packVersion: 3, course: { target: 'en', l1: 'bg' } })
    expect(runs).toBe(2)
  })

  it('runs again when the native language changes, even at the same corpus version (plan 10)', () => {
    const store = createStore<{ packVersion: number | null; course: Course }>({ packVersion: 0, course: { target: 'en', l1: 'bg' } })
    let runs = 0
    const stop = watchContentFiles({ store }, () => (runs += 1))
    store.set({ packVersion: 0, course: { target: 'en', l1: 'de' } })
    expect(runs).toBe(2)
    stop()
  })

  it('runs again when the course changes, even at the same corpus version and L1 (spec §8.6)', () => {
    const store = createStore<{ packVersion: number | null; course: Course }>({ packVersion: 0, course: { target: 'en', l1: 'bg' } })
    let runs = 0
    const stop = watchContentFiles({ store }, () => (runs += 1))
    // A new snapshot names the same course in a new object: not a change.
    store.set({ packVersion: 0, course: { target: 'en', l1: 'bg' } })
    expect(runs).toBe(1)
    store.set({ packVersion: 0, course: { target: 'de', l1: 'bg' } })
    expect(runs).toBe(2)
    stop()
  })
})
