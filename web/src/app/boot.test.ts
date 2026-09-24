import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Client, SqlDriver } from '@wordado/client-data'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import { testEnv } from '@wordado/client-data/src/testing/testEnv'
import { describe, expect, it } from 'vitest'
import { Boot, type BootDeps, type LockPort } from './boot'

/** Wraps a driver so the test can see how many times it was closed. */
function countingDriver(driver: SqlDriver): { readonly driver: SqlDriver; readonly closes: () => number } {
  let closes = 0
  return {
    driver: {
      ...driver,
      close: async () => {
        closes += 1
        await driver.close()
      },
    },
    closes: () => closes,
  }
}

/** A deferred promise, so a test can hold `openDriver()` open and resolve it on request. */
function deferred<T>(): { readonly promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** A boot over an in-memory database and the sample; `release` plays another tab taking over. */
function boot(over: Partial<BootDeps> = {}, free = true) {
  const deps: BootDeps = {
    env: testEnv(),
    l1: 'bg',
    openDriver: async () => ({ driver: nodeSqliteDriver(), backend: 'opfs' }),
    fetchManifest: async () => sampleManifest,
    fetchPack: sampleFetcher,
    ...over,
  }
  let owner = false
  let release: () => Promise<void> = async () => undefined
  const lock: LockPort = {
    acquire: async () => (owner = free),
    takeOver: async () => {
      owner = true
    },
  }
  const b = new Boot(deps, (r) => {
    release = r
    return lock
  })
  return { boot: b, release: () => release() }
}

const ready = (b: Boot): Client => {
  const state = b.store.get()
  if (state.status !== 'ready') throw new Error(`not ready: ${state.status}`)
  return state.client
}

describe('Boot', () => {
  it('opens the database, installs the bundled pack and starts a session', async () => {
    const calls: string[] = []
    const { boot: b } = boot({
      prepare: async () => {
        calls.push(`prepare while ${b.store.get().status}`)
      },
      onReady: async () => {
        calls.push(`onReady while ${b.store.get().status}`)
      },
    })
    await b.start()
    const client = ready(b)
    expect(client.snapshot.corpus?.entries.size).toBe(60)
    expect(client.snapshot.plan?.newWords).toHaveLength(10)
    expect(calls).toEqual(['prepare while starting', 'onReady while ready'])
  })

  it('shows the database as open elsewhere, then takes it over on request', async () => {
    const { boot: b } = boot({}, false)
    await b.start()
    expect(b.store.get().status).toBe('elsewhere')
    await b.takeOver()
    expect(ready(b).snapshot.corpus).not.toBeNull()
  })

  it('closes the client when another tab takes over', async () => {
    const { boot: b, release } = boot()
    await b.start()
    const client = ready(b)
    await release()
    expect(b.store.get().status).toBe('elsewhere')
    await expect(client.updateSettings({ newWordLimit: 5 })).rejects.toThrow()
  })

  it('starts offline from the pack it already has', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'wordado-boot-')), 'demo.sqlite')
    const first = boot({ openDriver: async () => ({ driver: nodeSqliteDriver(file), backend: 'opfs' }) })
    await first.boot.start()
    await first.release()
    const offline = boot({
      openDriver: async () => ({ driver: nodeSqliteDriver(file), backend: 'opfs' }),
      fetchManifest: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    await offline.boot.start()
    expect(ready(offline.boot).snapshot.corpus?.entries.size).toBe(60)
  })

  it('fails with a reason when there is no pack and none can be fetched, and recovers on retry', async () => {
    let online = false
    const { boot: b } = boot({
      fetchManifest: async () => {
        if (!online) throw new TypeError('Failed to fetch')
        return sampleManifest
      },
    })
    await b.start()
    expect(b.store.get()).toEqual({ status: 'failed', message: 'Failed to fetch', reason: 'content' })
    online = true
    await b.retry()
    expect(ready(b).snapshot.corpus).not.toBeNull()
  })

  it('does not become ready when the lock is lost while it is still opening', async () => {
    const other: { takeOver?: () => Promise<void> } = {}
    const { boot: b, release } = boot({
      fetchManifest: async () => {
        await other.takeOver!()
        return sampleManifest
      },
    })
    other.takeOver = release
    await b.start()
    expect(b.store.get().status).toBe('elsewhere')
  })

  it('closes the driver and only hands over the lock once it has, when release lands during openDriver', async () => {
    const opened = deferred<{ driver: SqlDriver; backend: 'opfs' }>()
    const { driver, closes } = countingDriver(nodeSqliteDriver())
    const { boot: b, release } = boot({ openDriver: () => opened.promise })

    const startPromise = b.start()
    // Let start() reach the point where it is awaiting openDriver().
    await Promise.resolve()
    await Promise.resolve()

    let released = false
    const releasePromise = release().then(() => {
      released = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(released).toBe(false)
    expect(closes()).toBe(0)

    opened.resolve({ driver, backend: 'opfs' })
    await releasePromise
    await startPromise

    expect(released).toBe(true)
    expect(closes()).toBe(1)
    expect(b.store.get().status).toBe('elsewhere')
  })

  it('closes the driver when Client.open fails, and retry succeeds with a fresh one', async () => {
    const failing = countingDriver({
      ...nodeSqliteDriver(),
      exec: async () => {
        throw new Error('The disk is unavailable')
      },
    })
    let attempt = 0
    const { boot: b } = boot({
      openDriver: async () => {
        attempt += 1
        return attempt === 1 ? { driver: failing.driver, backend: 'opfs' } : { driver: nodeSqliteDriver(), backend: 'opfs' }
      },
    })
    await b.start()
    expect(b.store.get()).toEqual({ status: 'failed', message: 'The disk is unavailable', reason: 'storage' })
    expect(failing.closes()).toBe(1)

    await b.retry()
    expect(ready(b).snapshot.corpus).not.toBeNull()
  })

  it('retries the opening on a storage failure without touching the lock', async () => {
    let acquireCalls = 0
    const failing = countingDriver({
      ...nodeSqliteDriver(),
      exec: async () => {
        throw new Error('The disk is unavailable')
      },
    })
    let attempt = 0
    const deps: BootDeps = {
      env: testEnv(),
      l1: 'bg',
      openDriver: async () => {
        attempt += 1
        return attempt === 1 ? { driver: failing.driver, backend: 'opfs' } : { driver: nodeSqliteDriver(), backend: 'opfs' }
      },
      fetchManifest: async () => sampleManifest,
      fetchPack: sampleFetcher,
    }
    const lock: LockPort = {
      acquire: async () => {
        acquireCalls += 1
        return true
      },
      takeOver: async () => undefined,
    }
    const b = new Boot(deps, () => lock)
    await b.start()
    expect(b.store.get()).toMatchObject({ status: 'failed', reason: 'storage' })
    expect(acquireCalls).toBe(1)
    await b.retry()
    expect(ready(b).snapshot.corpus).not.toBeNull()
    expect(acquireCalls).toBe(1)
  })

  it('fails when the lock cannot be acquired', async () => {
    const deps: BootDeps = {
      env: testEnv(),
      l1: 'bg',
      openDriver: async () => ({ driver: nodeSqliteDriver(), backend: 'opfs' }),
      fetchManifest: async () => sampleManifest,
      fetchPack: sampleFetcher,
    }
    const lock: LockPort = {
      acquire: async () => {
        throw new Error('Locks are not available in this context')
      },
      takeOver: async () => undefined,
    }
    const b = new Boot(deps, () => lock)
    await b.start()
    expect(b.store.get()).toEqual({ status: 'failed', message: 'Locks are not available in this context', reason: 'lock' })
  })

  it('fails when a take-over cannot get the lock', async () => {
    const deps: BootDeps = {
      env: testEnv(),
      l1: 'bg',
      openDriver: async () => ({ driver: nodeSqliteDriver(), backend: 'opfs' }),
      fetchManifest: async () => sampleManifest,
      fetchPack: sampleFetcher,
    }
    const lock: LockPort = {
      acquire: async () => false,
      takeOver: async () => {
        throw new Error('The owner never answered')
      },
    }
    const b = new Boot(deps, () => lock)
    await b.start()
    expect(b.store.get().status).toBe('elsewhere')
    await b.takeOver()
    expect(b.store.get()).toEqual({ status: 'failed', message: 'The owner never answered', reason: 'lock' })
  })

  it('retries the acquire after a lock failure, and becomes ready once it succeeds', async () => {
    let succeed = false
    let acquireCalls = 0
    const deps: BootDeps = {
      env: testEnv(),
      l1: 'bg',
      openDriver: async () => ({ driver: nodeSqliteDriver(), backend: 'opfs' }),
      fetchManifest: async () => sampleManifest,
      fetchPack: sampleFetcher,
    }
    const lock: LockPort = {
      acquire: async () => {
        acquireCalls += 1
        if (!succeed) throw new Error('Locks are not available in this context')
        return true
      },
      takeOver: async () => undefined,
    }
    const b = new Boot(deps, () => lock)
    await b.start()
    expect(b.store.get()).toMatchObject({ status: 'failed', reason: 'lock' })
    succeed = true
    await b.retry()
    expect(acquireCalls).toBe(2)
    expect(ready(b).snapshot.corpus).not.toBeNull()
  })

  it('retries the take-over after it fails, and becomes ready once it succeeds', async () => {
    let succeed = false
    let takeOverCalls = 0
    const deps: BootDeps = {
      env: testEnv(),
      l1: 'bg',
      openDriver: async () => ({ driver: nodeSqliteDriver(), backend: 'opfs' }),
      fetchManifest: async () => sampleManifest,
      fetchPack: sampleFetcher,
    }
    const lock: LockPort = {
      acquire: async () => false,
      takeOver: async () => {
        takeOverCalls += 1
        if (!succeed) throw new Error('The owner never answered')
      },
    }
    const b = new Boot(deps, () => lock)
    await b.start()
    expect(b.store.get().status).toBe('elsewhere')
    await b.takeOver()
    expect(b.store.get()).toMatchObject({ status: 'failed', reason: 'lock' })
    succeed = true
    await b.retry()
    expect(takeOverCalls).toBe(2)
    expect(ready(b).snapshot.corpus).not.toBeNull()
  })
})
