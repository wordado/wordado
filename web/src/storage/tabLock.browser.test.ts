import { describe, expect, it } from 'vitest'
import { TabLock } from './tabLock'

const unique = () => `lock-${crypto.randomUUID()}`

function tab(name: string, log: string[], label: string, release: () => Promise<void> = async () => undefined) {
  const lock = new TabLock({
    name,
    waitMs: 300,
    release: async () => {
      log.push(`${label} releasing`)
      await release()
      log.push(`${label} released`)
    },
  })
  lock.store.subscribe(() => log.push(`${label} ${lock.state}`))
  return lock
}

describe('TabLock', () => {
  it('lets one tab own the database and tells the other it is open elsewhere', async () => {
    const name = unique()
    const log: string[] = []
    const a = tab(name, log, 'a')
    const b = tab(name, log, 'b')
    expect(await a.acquire()).toBe(true)
    expect(await b.acquire()).toBe(false)
    expect([a.state, b.state]).toEqual(['owner', 'elsewhere'])
    await a.dispose()
    await b.dispose()
  })

  it('takes over politely: the owner releases first, then the new tab owns it', async () => {
    const name = unique()
    const log: string[] = []
    const a = tab(name, log, 'a')
    const b = tab(name, log, 'b')
    await a.acquire()
    await b.acquire()
    log.length = 0
    await b.takeOver()
    expect(log).toEqual(['b idle', 'a releasing', 'a released', 'a elsewhere', 'b owner'])
    // And back again.
    log.length = 0
    await a.takeOver()
    expect(log).toEqual(['a idle', 'b releasing', 'b released', 'b elsewhere', 'a owner'])
    await a.dispose()
    await b.dispose()
  })

  it('steals the lock from an owner that does not answer, which then closes and says so', async () => {
    const name = unique()
    const log: string[] = []
    const frozen = tab(name, log, 'a', () => new Promise<void>(() => undefined))
    // A tab that does not hear the request at all: its channel is closed.
    await frozen.acquire()
    await frozen.dispose({ keepLock: true })
    const b = tab(name, log, 'b')
    await b.acquire()
    log.length = 0
    await b.takeOver()
    expect(b.state).toBe('owner')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(frozen.state).toBe('elsewhere')
    expect(log).toContain('a releasing')
    await b.dispose()
  })

  it('does nothing when the owner asks to take over', async () => {
    const name = unique()
    const log: string[] = []
    const a = tab(name, log, 'a')
    await a.acquire()
    log.length = 0
    await a.takeOver()
    expect(log).toEqual([])
    await a.dispose()
  })

  it('frees the lock on dispose', async () => {
    const name = unique()
    const a = tab(name, [], 'a')
    await a.acquire()
    await a.dispose()
    const b = tab(name, [], 'b')
    expect(await b.acquire()).toBe(true)
    await b.dispose()
  })

  it('does not steal from a slow owner with an open channel', async () => {
    const name = unique()
    const log: string[] = []
    const slow = async () => new Promise<void>((resolve) => setTimeout(resolve, 600))
    const a = tab(name, log, 'a', slow)
    const b = tab(name, log, 'b')
    await a.acquire()
    await b.acquire()
    log.length = 0
    await b.takeOver()
    expect(log).toEqual(['b idle', 'a releasing', 'a released', 'a elsewhere', 'b owner'])
    // Verify release only ran once
    const releaseCount = log.filter((x) => x === 'a releasing').length
    expect(releaseCount).toBe(1)
    await a.dispose()
    await b.dispose()
  })

  it('handles two take-over requests in a row: release runs once', async () => {
    const name = unique()
    const log: string[] = []
    const a = tab(name, log, 'a')
    const b = tab(name, log, 'b')
    const c = tab(name, log, 'c')
    await a.acquire()
    await b.acquire()
    await c.acquire()
    log.length = 0
    // Two requests in a row from b and c
    await Promise.all([b.takeOver(), c.takeOver()])
    // One of them should be owner; let's check the final state
    expect([b.state, c.state].includes('owner')).toBe(true)
    // Verify a's release only ran once
    const releaseCount = log.filter((x) => x === 'a releasing').length
    expect(releaseCount).toBe(1)
    await a.dispose()
    await b.dispose()
    await c.dispose()
  })

  it('shares takeOver promise: concurrent calls on same tab end as owner', async () => {
    const name = unique()
    const log: string[] = []
    const a = tab(name, log, 'a')
    const b = tab(name, log, 'b')
    await a.acquire()
    await b.acquire()
    log.length = 0
    // Two concurrent takeOver() calls on b (same tab)
    await Promise.all([b.takeOver(), b.takeOver()])
    expect(b.state).toBe('owner')
    // Verify a's release only ran once
    const releaseCount = log.filter((x) => x === 'a releasing').length
    expect(releaseCount).toBe(1)
    // Verify no self-steal: b never released (would show 'b releasing')
    const bReleasing = log.filter((x) => x === 'b releasing').length
    expect(bReleasing).toBe(0)
    // Verify b never went elsewhere after becoming owner
    const bOwnerIdx = log.indexOf('b owner')
    const bElsewhereAfter = log.slice(bOwnerIdx + 1).indexOf('b elsewhere')
    expect(bElsewhereAfter).toBe(-1)
    await a.dispose()
    await b.dispose()
  })

  it('dispose() while takeOver() pending does not steal and frees the lock', async () => {
    const name = unique()
    const log: string[] = []
    // a has slow release so b's request won't succeed before dispose
    const a = tab(name, log, 'a', async () => new Promise<void>((resolve) => setTimeout(resolve, 600)))
    const b = tab(name, log, 'b')
    await a.acquire()
    await b.acquire()
    log.length = 0
    // Start takeOver but dispose b before it steals
    const takeOverPromise = b.takeOver()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await b.dispose()
    try {
      await takeOverPromise
    } catch {
      // May throw if disposed; that's ok
    }
    // After dispose, b should not be owner (disposed before steal at ~350ms)
    expect(b.state).not.toBe('owner')
    // a's release is still pending; let it complete
    await new Promise((resolve) => setTimeout(resolve, 600))
    // Now lock should be free
    await a.dispose()
    // Verify lock is free: a fresh TabLock can acquire it
    const fresh = tab(name, [], 'fresh')
    expect(await fresh.acquire()).toBe(true)
    await fresh.dispose()
  })
})
