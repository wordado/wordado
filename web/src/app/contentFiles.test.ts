import { createStore } from '@wordado/client-data'
import { describe, expect, it } from 'vitest'
import { watchContentFiles } from './contentFiles'

describe('watchContentFiles', () => {
  it('runs at once, then each time the active corpus version changes, until stopped', () => {
    const store = createStore<{ packVersion: number | null }>({ packVersion: 1 })
    let runs = 0
    const stop = watchContentFiles({ store }, () => (runs += 1))
    expect(runs).toBe(1)
    store.set({ packVersion: 1 })
    expect(runs).toBe(1)
    store.set({ packVersion: 2 })
    expect(runs).toBe(2)
    stop()
    store.set({ packVersion: 3 })
    expect(runs).toBe(2)
  })
})
