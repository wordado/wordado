import { describe, expect, it } from 'vitest'
import { readInterfaceLanguage, writeInterfaceLanguage } from './prefs'

/** The small slice of the Cache API `prefs.ts` uses, backed by a Map. */
function fakeCacheStorage(): CacheStorage {
  const store = new Map<string, Response>()
  const cache = {
    put: async (request: RequestInfo, response: Response) => {
      store.set(String(request), response)
    },
    match: async (request: RequestInfo) => store.get(String(request)),
  }
  return { open: async () => cache } as unknown as CacheStorage
}

describe('interface-language prefs (read by the service worker)', () => {
  it('round-trips every locale, including German', async () => {
    const cacheStorage = fakeCacheStorage()
    await writeInterfaceLanguage('de', cacheStorage)
    expect(await readInterfaceLanguage(cacheStorage)).toBe('de')
    await writeInterfaceLanguage('bg', cacheStorage)
    expect(await readInterfaceLanguage(cacheStorage)).toBe('bg')
    await writeInterfaceLanguage('en', cacheStorage)
    expect(await readInterfaceLanguage(cacheStorage)).toBe('en')
  })

  it('falls back to English when nothing was ever written', async () => {
    expect(await readInterfaceLanguage(fakeCacheStorage())).toBe('en')
  })

  it('falls back to English when the cache cannot be read', async () => {
    const broken = { open: () => Promise.reject(new Error('no cache storage')) } as unknown as CacheStorage
    expect(await readInterfaceLanguage(broken)).toBe('en')
  })
})
