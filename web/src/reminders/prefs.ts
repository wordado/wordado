import { LOCALES, type Locale } from '../i18n/i18n'

/** A cache the service worker can read: it has no localStorage (decision recorded in this plan). */
export const PREFS_CACHE = 'wordado-prefs'
const PREFS_URL = '/__wordado/prefs'

export async function writeInterfaceLanguage(lang: Locale, cacheStorage: CacheStorage | undefined = globalThis.caches): Promise<void> {
  if (!cacheStorage) return
  const cache = await cacheStorage.open(PREFS_CACHE)
  await cache.put(PREFS_URL, new Response(JSON.stringify({ lang }), { headers: { 'content-type': 'application/json' } }))
}

export async function readInterfaceLanguage(cacheStorage: CacheStorage | undefined = globalThis.caches): Promise<Locale> {
  try {
    const response = await (await cacheStorage!.open(PREFS_CACHE)).match(PREFS_URL)
    const lang = response ? ((await response.json()) as { lang?: unknown }).lang : null
    return LOCALES.find((l) => l === lang) ?? 'en'
  } catch {
    return 'en'
  }
}
