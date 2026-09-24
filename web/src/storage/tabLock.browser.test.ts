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
})
