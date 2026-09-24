import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Client, SqlDriver, SyncTransport } from '@wordado/client-data'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import { testEnv } from '@wordado/client-data/src/testing/testEnv'
import { FakeServer } from '@wordado/client-data/src/testing/fakeServer'
import type { WordId } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { accountStorage, DEMO_FILE, learnerFile, memoryStorage } from '../account/storage'
import { answerTo, disk, flaky } from '../test/disk'
import { Boot, type BootDeps, type LockPort } from './boot'

const hello = answerTo('c:hello-1')

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

describe('Boot with accounts (spec §8.6, §9.1)', () => {
  it('opens the demo without an account, and the learner’s own file, with a transport, with one', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    const { boot: b } = boot({ env, accounts, openDriver: d.openDriver, deleteDatabase: d.deleteDatabase, transport: () => server })
    await b.start()
    expect(b.store.get()).toMatchObject({ status: 'ready', account: null })
    expect(d.exists(DEMO_FILE)).toBe(true)
    expect(await ready(b).sync()).toBe('skipped')

    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    await b.switchTo({ deleteFile: DEMO_FILE })
    expect(b.store.get()).toMatchObject({ status: 'ready', account: { userId: 'u1' } })
    expect(d.exists(DEMO_FILE)).toBe(false)
    expect(d.exists(learnerFile('u1'))).toBe(true)
    const learner = ready(b)
    await learner.answer(hello)
    expect(await learner.sync()).toBe('synced')
    expect(server.events.size).toBe(1)
  })

  it('finishes a carry-over the last session could not, then deletes the demo (spec §8.6)', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const transport = flaky(server)
    const accounts = accountStorage(memoryStorage())
    const { boot: b } = boot({ env, accounts, openDriver: d.openDriver, deleteDatabase: d.deleteDatabase, transport: () => transport })
    await b.start()
    const demo = ready(b)
    await demo.answer(hello)
    // Signed in, but the push did not get through: the demo stays attached and flagged.
    await demo.attachUser('u1', transport)
    expect(await demo.sync({ force: true })).toBe('failed')
    accounts.save({ userId: 'u1', email: 'ana@example.com', carryOver: true })
    await b.switchTo()
    expect(d.exists(DEMO_FILE)).toBe(true)
    expect(accounts.read()?.carryOver).toBe(true)
    expect(server.events.size).toBe(0)

    // The next open, online: the demo's answer reaches the account from the demo's device, once.
    transport.online = true
    await b.switchTo()
    expect(server.events.size).toBe(1)
    expect([...server.events.values()][0]!.deviceId).toBe(demo.snapshot.deviceId)
    expect(d.exists(DEMO_FILE)).toBe(false)
    expect(accounts.read()).toEqual({ userId: 'u1', email: 'ana@example.com', carryOver: false })
    const learner = ready(b)
    expect(await learner.sync()).toBe('synced')
    expect(learner.snapshot.states.get('c:hello-1' as WordId)?.reps).toBe(1)
    await b.switchTo()
    expect(server.events.size).toBe(1)
  })

  it('leaves a demo attached to nobody alone, and does not open it when no carry-over is owed', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    const opened: string[] = []
    const { boot: b } = boot({
      env,
      accounts,
      openDriver: async (file) => {
        opened.push(file)
        return d.openDriver(file)
      },
      deleteDatabase: d.deleteDatabase,
      transport: () => server,
    })
    await b.start()
    await ready(b).answer(hello)
    accounts.save({ userId: 'u1', email: 'ana@example.com', carryOver: true })
    await b.switchTo()
    expect(d.exists(DEMO_FILE)).toBe(true)
    expect(server.events.size).toBe(0)
    expect(accounts.read()?.carryOver).toBe(false)
    opened.length = 0
    await b.switchTo()
    expect(opened).toEqual([learnerFile('u1')])
  })

  it('drains an answer being written and flushes it before letting go (spec §9.1)', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const { boot: b, release } = boot({ env, accounts, openDriver: d.openDriver, deleteDatabase: d.deleteDatabase, transport: () => server })
    await b.start()
    const client = ready(b)
    const answering = client.answer(hello)
    await release()
    await answering
    expect(b.store.get().status).toBe('elsewhere')
    expect(server.events.size).toBe(1)
  })

  it('lets go after the flush timeout when the server hangs', async () => {
    const d = disk()
    const env = testEnv()
    const accounts = accountStorage(memoryStorage())
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const hanging: SyncTransport = { push: () => new Promise(() => undefined), pull: () => new Promise(() => undefined) }
    const { boot: b, release } = boot({ env, accounts, openDriver: d.openDriver, deleteDatabase: d.deleteDatabase, transport: () => hanging, flushTimeoutMs: 20 })
    await b.start()
    await ready(b).answer(hello)
    const started = Date.now()
    await release()
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(b.store.get().status).toBe('elsewhere')
  })

  it('starts the sync loop for a learner only, and stops it on a switch and on release', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    const log: string[] = []
    const { boot: b, release } = boot({
      env,
      accounts,
      openDriver: d.openDriver,
      deleteDatabase: d.deleteDatabase,
      transport: () => server,
      startSync: (_client, backend) => {
        log.push(`start ${backend}`)
        return () => log.push('stop')
      },
    })
    await b.start()
    expect(log).toEqual([])
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    await b.switchTo()
    await b.switchTo()
    await release()
    expect(log).toEqual(['start opfs', 'stop', 'start opfs', 'stop'])
  })

  it('hands over cleanly when a take-over lands in the middle of a switch', async () => {
    const d = disk()
    const env = testEnv()
    const accounts = accountStorage(memoryStorage())
    const gate = deferred<void>()
    const reached = deferred<void>()
    const closes: string[] = []
    const { boot: b, release } = boot({
      env,
      accounts,
      openDriver: async (file) => {
        if (file !== DEMO_FILE) {
          reached.resolve()
          await gate.promise
        }
        const { driver } = countingDriver(nodeSqliteDriver(d.path(file)))
        return { driver: { ...driver, close: async () => (closes.push(file), driver.close()) }, backend: 'opfs' }
      },
      deleteDatabase: d.deleteDatabase,
      transport: () => new FakeServer({ now: env.now }),
    })
    await b.start()
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const switching = b.switchTo()
    // The take-over lands while the learner's file is being opened: that open is closed again, never used.
    await reached.promise
    const releasing = release()
    gate.resolve()
    await Promise.all([switching, releasing])
    expect(b.store.get().status).toBe('elsewhere')
    expect(closes).toEqual([DEMO_FILE, learnerFile('u1')])
  })

  it('hands over only after a switch has closed the file it was closing', async () => {
    const d = disk()
    const env = testEnv()
    const accounts = accountStorage(memoryStorage())
    const closing = deferred<void>()
    const log: string[] = []
    const { boot: b, release } = boot({
      env,
      accounts,
      openDriver: async (file) => {
        const driver = nodeSqliteDriver(d.path(file))
        return {
          driver: {
            ...driver,
            close: async () => {
              if (file === DEMO_FILE) await closing.promise
              await driver.close()
              log.push(`closed ${file}`)
            },
          },
          backend: 'opfs',
        }
      },
      deleteDatabase: d.deleteDatabase,
    })
    await b.start()
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const switching = b.switchTo()
    const releasing = release().then(() => log.push('released'))
    await new Promise((r) => setTimeout(r, 10))
    expect(log).toEqual([])
    closing.resolve()
    await Promise.all([switching, releasing])
    expect(log).toEqual([`closed ${DEMO_FILE}`, 'released'])
  })

  it('two overlapping switchTo calls end with exactly one Client open, and its sync loop started once', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    const opened: string[] = []
    const closed: string[] = []
    const log: string[] = []
    const { boot: b } = boot({
      env,
      accounts,
      openDriver: async (file) => {
        opened.push(file)
        const { driver } = countingDriver(nodeSqliteDriver(d.path(file)))
        return { driver: { ...driver, close: async () => (closed.push(file), driver.close()) }, backend: 'opfs' }
      },
      deleteDatabase: d.deleteDatabase,
      transport: () => server,
      startSync: (_client, backend) => {
        log.push(`start ${backend}`)
        return () => log.push('stop')
      },
    })
    await b.start()
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const p1 = b.switchTo()
    const p2 = b.switchTo()
    await Promise.all([p1, p2])
    expect(b.store.get().status).toBe('ready')
    const readyFile = learnerFile('u1')
    // Every driver opened across the two switches is closed again, except the one `ready` holds.
    const leaked = opened.filter((f) => f !== readyFile && !closed.includes(f))
    expect(leaked).toEqual([])
    expect(closed.includes(readyFile)).toBe(false)
    expect(log.filter((l) => l === 'start opfs')).toHaveLength(1)
    expect(log.filter((l) => l === 'stop')).toHaveLength(0)
  })

  it('a release mid-switch waits for the switch’s delete to finish before letting go', async () => {
    const d = disk()
    const env = testEnv()
    const accounts = accountStorage(memoryStorage())
    const deleting = deferred<void>()
    const log: string[] = []
    const { boot: b, release } = boot({
      env,
      accounts,
      openDriver: d.openDriver,
      deleteDatabase: async (file) => {
        await deleting.promise
        log.push(`deleted ${file}`)
      },
      transport: () => new FakeServer({ now: env.now }),
    })
    await b.start()
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const switching = b.switchTo({ deleteFile: DEMO_FILE })
    const releasing = release().then(() => log.push('released'))
    await new Promise((r) => setTimeout(r, 10))
    expect(log).toEqual([])
    deleting.resolve()
    await Promise.all([switching, releasing])
    expect(log).toEqual([`deleted ${DEMO_FILE}`, 'released'])
  })

  it('flushes past a backoff on hand-over, so a pending answer still reaches the server (spec §9.1)', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    let fail = true
    const transport: SyncTransport = {
      push: (page) => (fail ? Promise.reject(new Error('offline')) : server.push(page)),
      pull: (request) => (fail ? Promise.reject(new Error('offline')) : server.pull(request)),
    }
    const { boot: b, release } = boot({ env, accounts, openDriver: d.openDriver, deleteDatabase: d.deleteDatabase, transport: () => transport })
    await b.start()
    const client = ready(b)
    // A failed sync sets a backoff the flush must ignore.
    expect(await client.sync()).toBe('failed')
    expect(client.snapshot.sync.nextAttemptAt).not.toBeNull()
    await client.answer(hello)
    fail = false
    await release()
    expect(b.store.get().status).toBe('elsewhere')
    expect(server.events.size).toBe(1)
  })
})
