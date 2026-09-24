import { createStore } from '@wordado/client-data'
import { openSampleClient, sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import type { Corpus, PackDescriptor } from '@wordado/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from '../account/storage'
import { noteInstallReport, PACK_CHECK_INTERVAL_MS, refreshAudioOnActivation, startPackChecks } from './content'
import { AppLifecycle } from './lifecycle'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('content (spec §9.3)', () => {
  it('says the app is too old when a pack needs a newer one', () => {
    const l = new AppLifecycle({ storage: memoryStorage(), reload: () => undefined })
    noteInstallReport({ staged: [], appUpdateNeeded: [], rejected: [] }, l)
    expect(l.store.get().appTooOld).toBe(false)
    const newer: PackDescriptor = { pack_id: 'corpus-bg', l1: 'bg', corpus_version: 2, schema_version: 99, url: 'corpus-v2-bg.pack', sha256: '', bytes: 0 }
    noteInstallReport({ staged: [], appUpdateNeeded: [newer], rejected: [] }, l)
    expect(l.store.get().appTooOld).toBe(true)
  })

  it('checks for newer packs every six hours while online, and reports each check', async () => {
    const client = await openSampleClient()
    const reports: unknown[] = []
    let online = true
    const stop = startPackChecks({
      client: () => client,
      fetchManifest: async () => sampleManifest,
      fetchPack: sampleFetcher,
      online: () => online,
      onReport: (r) => reports.push(r),
    })
    await vi.advanceTimersByTimeAsync(PACK_CHECK_INTERVAL_MS)
    expect(reports).toHaveLength(1)
    online = false
    await vi.advanceTimersByTimeAsync(PACK_CHECK_INTERVAL_MS)
    expect(reports).toHaveLength(1)
    stop()
  })

  it('re-reads the audio index when a new pack becomes active, not before', async () => {
    const store = createStore<{ packVersion: number | null; corpus: Corpus | null }>({ packVersion: 1, corpus: null })
    const refreshed: (Corpus | null)[] = []
    const corpus = {} as Corpus
    const stop = refreshAudioOnActivation({ store }, { refresh: async (c) => void refreshed.push(c) })
    store.set({ packVersion: 1, corpus })
    expect(refreshed).toEqual([])
    store.set({ packVersion: 2, corpus })
    expect(refreshed).toEqual([corpus])
    stop()
    store.set({ packVersion: 3, corpus })
    expect(refreshed).toEqual([corpus])
  })
})
