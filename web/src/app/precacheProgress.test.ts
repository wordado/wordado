import { describe, expect, it } from 'vitest'
import { isPrecacheProgress, precacheProgressPlugin, type PrecacheProgress } from './precacheProgress'

describe('the installing worker’s progress (spec §9.1)', () => {
  it('posts the files settled of the precache list, one message a file, during install only', async () => {
    const posted: PrecacheProgress[] = []
    const plugin = precacheProgressPlugin(3, (m) => posted.push(m))
    await plugin.handlerDidComplete({ event: { type: 'install' } })
    // A file served from the cache later is not an install.
    await plugin.handlerDidComplete({ event: { type: 'fetch' } })
    await plugin.handlerDidComplete({ event: { type: 'install' } })
    expect(posted).toEqual([
      { type: 'PRECACHE_PROGRESS', done: 1, total: 3 },
      { type: 'PRECACHE_PROGRESS', done: 2, total: 3 },
    ])
  })

  it('does not count a file that failed, and never passes the total', async () => {
    const posted: PrecacheProgress[] = []
    const plugin = precacheProgressPlugin(1, (m) => posted.push(m))
    await plugin.handlerDidComplete({ event: { type: 'install' }, error: new Error('404') })
    await plugin.handlerDidComplete({ event: { type: 'install' } })
    await plugin.handlerDidComplete({ event: { type: 'install' } })
    expect(posted).toEqual([{ type: 'PRECACHE_PROGRESS', done: 1, total: 1 }])
  })

  it('says nothing for an empty list', async () => {
    const posted: PrecacheProgress[] = []
    await precacheProgressPlugin(0, (m) => posted.push(m)).handlerDidComplete({ event: { type: 'install' } })
    expect(posted).toEqual([])
  })

  it('recognises its own message and nothing else', () => {
    expect(isPrecacheProgress({ type: 'PRECACHE_PROGRESS', done: 2, total: 5 })).toBe(true)
    for (const other of [null, 'x', { type: 'SKIP_WAITING' }, { type: 'PRECACHE_PROGRESS', done: 6, total: 5 }, { type: 'PRECACHE_PROGRESS', done: 1, total: 0 }, { type: 'PRECACHE_PROGRESS', done: '1', total: 5 }]) {
      expect(isPrecacheProgress(other)).toBe(false)
    }
  })
})
