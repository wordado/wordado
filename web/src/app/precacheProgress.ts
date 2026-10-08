/** What the installing service worker posts to the open pages as it caches the new version's files (spec §9.1). */
export interface PrecacheProgress {
  readonly type: 'PRECACHE_PROGRESS'
  readonly done: number
  readonly total: number
}

export function isPrecacheProgress(data: unknown): data is PrecacheProgress {
  if (typeof data !== 'object' || data === null) return false
  const { type, done, total } = data as Partial<PrecacheProgress>
  return type === 'PRECACHE_PROGRESS' && Number.isInteger(done) && Number.isInteger(total) && done! >= 0 && total! > 0 && done! <= total!
}

/**
 * A Workbox plugin for the precache: counts the files of the list as each is
 * settled during `install` (fetched, or already cached unchanged) and posts
 * the count. Files, not bytes: the list gives no sizes, so this is the one
 * honest measure. A file served later from the cache is not an install and
 * is not counted.
 */
export function precacheProgressPlugin(total: number, post: (message: PrecacheProgress) => void) {
  let done = 0
  return {
    handlerDidComplete: async (details: { readonly event: { readonly type: string }; readonly error?: unknown }): Promise<void> => {
      if (details.event.type !== 'install' || details.error || total <= 0 || done >= total) return
      done += 1
      post({ type: 'PRECACHE_PROGRESS', done, total })
    },
  }
}
