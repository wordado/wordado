import type { CreditsFile } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../account/storage'
import { Credits, CREDITS_KEY } from './credits'

const CDN = 'https://content.wordado.com/manifest.json'
const v1: CreditsFile = { schema_version: 1, corpus_version: 1, sources: [{ source: 'FineWeb', attribution: 'From FineWeb (ODC-By 1.0).' }] }

describe('Credits', () => {
  it('shows what it fetched for this manifest, and remembers it', async () => {
    const storage = memoryStorage()
    const credits = new Credits({ storage, fetch: async () => v1 })
    await credits.refresh(CDN)
    expect(credits.store.get()).toEqual({ manifestUrl: CDN, credits: v1 })
    expect(JSON.parse(storage.getItem(CREDITS_KEY)!)).toEqual({ [CDN]: v1 })
  })

  it('offline, shows the copy this device saw last for the same manifest, and nothing for another', async () => {
    const storage = memoryStorage()
    await new Credits({ storage, fetch: async () => v1 }).refresh(CDN)
    const offline = new Credits({ storage, fetch: async () => null })
    await offline.refresh(CDN)
    expect(offline.store.get().credits).toEqual(v1)
    await offline.refresh('/content/sample/manifest.json')
    expect(offline.store.get()).toEqual({ manifestUrl: '/content/sample/manifest.json', credits: null })
  })

  it('reads a damaged stored copy as absent', async () => {
    const storage = memoryStorage()
    storage.setItem(CREDITS_KEY, '{not json')
    const credits = new Credits({ storage, fetch: async () => null })
    await credits.refresh(CDN)
    expect(credits.store.get().credits).toBeNull()
  })
})
