import { createStore } from '@wordado/client-data'
import { describe, expect, it } from 'vitest'
import { watchContentFiles } from './contentFiles'

describe('watchContentFiles', () => {
  it('runs at once, then each time the active corpus version changes, until stopped', () => {
    const store = createStore<{ packVersion: number | null; l1: string }>({ packVersion: 1, l1: 'bg' })
    let runs = 0
    const stop = watchContentFiles({ store }, () => (runs += 1))
    expect(runs).toBe(1)
    store.set({ packVersion: 1, l1: 'bg' })
    expect(runs).toBe(1)
    store.set({ packVersion: 2, l1: 'bg' })
    expect(runs).toBe(2)
    stop()
    store.set({ packVersion: 3, l1: 'bg' })
    expect(runs).toBe(2)
  })

  it('runs again when the native language changes, even at the same corpus version (plan 10)', () => {
    const store = createStore<{ packVersion: number | null; l1: string }>({ packVersion: 0, l1: 'bg' })
    let runs = 0
    const stop = watchContentFiles({ store }, () => (runs += 1))
    store.set({ packVersion: 0, l1: 'de' })
    expect(runs).toBe(2)
    stop()
  })
})
