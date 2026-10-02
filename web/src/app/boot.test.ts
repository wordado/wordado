import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, type PackFetcher, type SqlDriver, type SyncTransport } from '@wordado/client-data'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import { testEnv, type TestEnv } from '@wordado/client-data/src/testing/testEnv'
import { FakeServer } from '@wordado/client-data/src/testing/fakeServer'
import type { WordId } from '@wordado/core'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { accountStorage, DEMO_FILE, learnerFile, memoryStorage } from '../account/storage'
import { answerTo, chosenL1, disk, fileDriver, flaky } from '../test/disk'
import { Boot, type BootDeps, defaultL1, FLUSH_TIMEOUT_MS, type LockPort, OPEN_TIMEOUT_MS, SETUP_PULL_TIMEOUT_MS } from './boot'

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

/** A new in-memory database: the first-run setup's (plan 11). */
const fresh = async () => ({ driver: nodeSqliteDriver(), backend: 'opfs' as const })

/** A new in-memory database whose learner has chosen Bulgarian (`chosenL1`): it opens the ordinary way, without the setup. */
const chosen = async () => ({ driver: await chosenL1(nodeSqliteDriver()), backend: 'opfs' as const })

/** `openDriver`, each new file it opens naming Bulgarian (`chosenL1`), so it opens without the setup. */
const choosing =
  (openDriver: BootDeps['openDriver']): BootDeps['openDriver'] =>
  async (file) => {
    const opened = await openDriver(file)
    return { ...opened, driver: await chosenL1(opened.driver) }
  }

/**
 * A boot over an in-memory database and the sample; `release` plays another tab taking over. Its database names
 * Bulgarian already, so it opens without the first-run setup unless a test passes its own `openDriver`.
 */
function boot(over: Partial<BootDeps> = {}, free = true) {
  const deps: BootDeps = {
    env: testEnv(),
    l1: () => 'bg',
    openDriver: chosen,
    fetchManifest: async () => sampleManifest,
    fetchPack: sampleFetcher,
    ...over,
  }
  let release: () => Promise<void> = async () => undefined
  const locks: string[] = []
  const lock: LockPort = {
    acquire: async () => {
      locks.push('acquire')
      return free
    },
    takeOver: async () => undefined,
    drop: () => void locks.push('drop'),
  }
  const b = new Boot(deps, (r) => {
    release = r
    return lock
  })
  return { boot: b, release: () => release(), locks }
}

/**
 * A server that never answers: every push and pull it is asked for stays
 * pending for good, since nothing holds a way to settle it. `calls` records
 * each request, tagged with `when()` at the time it was made, so a test can
 * show a request was made, and when, and is still hanging.
 */
function hangingServer(when: () => string = () => ''): { readonly transport: SyncTransport; readonly calls: string[] } {
  const calls: string[] = []
  const never = <T>(kind: string): Promise<T> => {
    calls.push(`${kind}${when() ? ` while ${when()}` : ''}`)
    return new Promise<T>(() => undefined)
  }
  return { transport: { push: () => never('push'), pull: () => never('pull') }, calls }
}

/**
 * Watches `setTimeout` until the test ends, the timers still running as
 * usual; the returned function lists the delay of every timer armed so far.
 */
function timerDelays(): () => (number | undefined)[] {
  const spy = vi.spyOn(globalThis, 'setTimeout')
  onTestFinished(() => spy.mockRestore())
  return () => spy.mock.calls.map(([, delay]) => delay)
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
    const first = boot({ openDriver: async () => ({ driver: await chosenL1(await fileDriver(file)), backend: 'opfs' }) })
    await first.boot.start()
    await first.release()
    const offline = boot({
      openDriver: async () => ({ driver: await fileDriver(file), backend: 'opfs' }),
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

  it('hands the launch install’s report on', async () => {
    const reports: unknown[] = []
    const { boot: b } = boot({ onInstallReport: (r) => reports.push(r) })
    await b.start()
    expect(reports).toEqual([{ staged: ['corpus-bg'], appUpdateNeeded: [], rejected: [] }])
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
        return attempt === 1 ? { driver: failing.driver, backend: 'opfs' } : chosen()
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
      l1: () => 'bg',
      openDriver: async () => {
        attempt += 1
        return attempt === 1 ? { driver: failing.driver, backend: 'opfs' } : chosen()
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
      drop: () => undefined,
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
      l1: () => 'bg',
      openDriver: chosen,
      fetchManifest: async () => sampleManifest,
      fetchPack: sampleFetcher,
    }
    const lock: LockPort = {
      acquire: async () => {
        throw new Error('Locks are not available in this context')
      },
      takeOver: async () => undefined,
      drop: () => undefined,
    }
    const b = new Boot(deps, () => lock)
    await b.start()
    expect(b.store.get()).toEqual({ status: 'failed', message: 'Locks are not available in this context', reason: 'lock' })
  })

  it('fails when a take-over cannot get the lock', async () => {
    const deps: BootDeps = {
      env: testEnv(),
      l1: () => 'bg',
      openDriver: chosen,
      fetchManifest: async () => sampleManifest,
      fetchPack: sampleFetcher,
    }
    const lock: LockPort = {
      acquire: async () => false,
      takeOver: async () => {
        throw new Error('The owner never answered')
      },
      drop: () => undefined,
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
      l1: () => 'bg',
      openDriver: chosen,
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
      drop: () => undefined,
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
      l1: () => 'bg',
      openDriver: chosen,
      fetchManifest: async () => sampleManifest,
      fetchPack: sampleFetcher,
    }
    const lock: LockPort = {
      acquire: async () => false,
      takeOver: async () => {
        takeOverCalls += 1
        if (!succeed) throw new Error('The owner never answered')
      },
      drop: () => undefined,
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
    await b.switchTo({ deleteFiles: [DEMO_FILE] })
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

  it('deletes a flagged demo attached to nobody (it is not the account’s), clears the flag, and opens only the learner’s file after', async () => {
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
    expect(d.exists(DEMO_FILE)).toBe(false)
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
    const hung = hangingServer()
    // The server answers the open's first pull (plan 11), then hangs.
    const server = new FakeServer({ now: env.now })
    let hanging = false
    const transport: SyncTransport = {
      push: (page) => (hanging ? hung.transport.push(page) : server.push(page)),
      pull: (request) => (hanging ? hung.transport.pull(request) : server.pull(request)),
    }
    const { boot: b, release } = boot({ env, accounts, openDriver: choosing(d.openDriver), deleteDatabase: d.deleteDatabase, transport: () => transport, flushTimeoutMs: 20 })
    await b.start()
    hanging = true
    await ready(b).answer(hello)
    hung.calls.length = 0
    const delays = timerDelays()
    // Without the race against the flush timeout this never resolves, and the test times out.
    await release()
    expect(hung.calls).toContain('push')
    // The race was armed with the timeout this Boot was given, not the default.
    expect(delays()).toContain(20)
    expect(delays()).not.toContain(FLUSH_TIMEOUT_MS)
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
        const { driver } = countingDriver(await fileDriver(d.path(file)))
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
        const driver = await fileDriver(d.path(file))
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
        const { driver } = countingDriver(await fileDriver(d.path(file)))
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
    const switching = b.switchTo({ deleteFiles: [DEMO_FILE] })
    const releasing = release().then(() => log.push('released'))
    await new Promise((r) => setTimeout(r, 10))
    expect(log).toEqual([])
    deleting.resolve()
    await Promise.all([switching, releasing])
    expect(log).toEqual([`deleted ${DEMO_FILE}`, 'released'])
  })

  it('installs from the demo’s manifest for the demo and the learner’s for a learner, and says whose it prepares (plan 7)', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    const asked: (string | null)[] = []
    const prepared: (string | null)[] = []
    const { boot: b } = boot({
      env,
      accounts,
      openDriver: choosing(d.openDriver),
      deleteDatabase: d.deleteDatabase,
      transport: () => server,
      fetchManifest: async (account) => {
        asked.push(account?.userId ?? null)
        return sampleManifest
      },
      prepare: async (_client, account) => void prepared.push(account?.userId ?? null),
    })
    await b.start()
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    await b.switchTo({ deleteFiles: [DEMO_FILE] })
    expect(asked).toEqual([null, 'u1'])
    expect(prepared).toEqual([null, 'u1'])
  })

  it('fails with the content reason, and recovers on retry, when a new learner’s manifest cannot be fetched', async () => {
    const accounts = accountStorage(memoryStorage())
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    let online = false
    const { boot: b } = boot({
      accounts,
      transport: () => new FakeServer({ now: () => Date.now() }),
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

  it('deletes several files, in order, inside the same serialised close step', async () => {
    const d = disk()
    const env = testEnv()
    const accounts = accountStorage(memoryStorage())
    const deleted: string[] = []
    const { boot: b } = boot({
      env,
      accounts,
      openDriver: d.openDriver,
      deleteDatabase: async (file) => {
        deleted.push(file)
      },
      transport: () => new FakeServer({ now: env.now }),
    })
    await b.start()
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    await b.switchTo({ deleteFiles: [DEMO_FILE, learnerFile('u0')] })
    expect(deleted).toEqual([DEMO_FILE, learnerFile('u0')])
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
    // The open's first pull (plan 11) failed, which set a backoff the flush must ignore.
    expect(client.snapshot.sync.lastError).not.toBeNull()
    expect(client.snapshot.sync.nextAttemptAt).not.toBeNull()
    await client.answer(hello)
    fail = false
    await release()
    expect(b.store.get().status).toBe('elsewhere')
    expect(server.events.size).toBe(1)
  })

  it('says whether a switch ran: not once the lock has passed to another tab', async () => {
    const d = disk()
    const accounts = accountStorage(memoryStorage())
    const { boot: b, release } = boot({ accounts, openDriver: d.openDriver, deleteDatabase: d.deleteDatabase })
    await b.start()
    expect(await b.switchTo()).toBe(true)
    await release()
    expect(await b.switchTo({ deleteFiles: [DEMO_FILE] })).toBe(false)
    expect(d.exists(DEMO_FILE)).toBe(true)
  })

  it('bounds an owed carry-over by the flush timeout, so a hung server never holds the launch; the flag stays', async () => {
    const d = disk()
    const env = testEnv()
    const accounts = accountStorage(memoryStorage())
    const hung = hangingServer(() => b.store.get().status)
    // The learner's new file waits for its first pull (plan 11) only briefly too.
    const { boot: b } = boot({
      env,
      accounts,
      openDriver: choosing(d.openDriver),
      deleteDatabase: d.deleteDatabase,
      transport: () => hung.transport,
      flushTimeoutMs: 20,
      setupPullTimeoutMs: 20,
    })
    await b.start()
    await ready(b).answer(hello)
    await ready(b).attachUser('u1')
    accounts.save({ userId: 'u1', email: 'ana@example.com', carryOver: true })
    hung.calls.length = 0
    const delays = timerDelays()
    // Without the race against the flush timeout this never resolves, and the test times out.
    await b.switchTo()
    // The carry-over's push reached the server before Boot was ready, and Boot became ready while it still hangs.
    expect(hung.calls).toContain('push while starting')
    // The race was armed with the timeout this Boot was given, not the default.
    expect(delays()).toContain(20)
    expect(delays()).not.toContain(FLUSH_TIMEOUT_MS)
    expect(b.store.get()).toMatchObject({ status: 'ready', account: { userId: 'u1' } })
    expect(accounts.read()?.carryOver).toBe(true)
    expect(d.exists(DEMO_FILE)).toBe(true)
  })
})

describe('Boot sweeps files no account owns (spec §8.6)', () => {
  /** A boot over `d` that lists and deletes files, with a record in `accounts`. */
  function sweeping(d: ReturnType<typeof disk>, accounts: ReturnType<typeof accountStorage>, server: SyncTransport) {
    return boot({
      env: testEnv(),
      accounts,
      openDriver: d.openDriver,
      deleteDatabase: d.deleteDatabase,
      listDatabases: d.listDatabases,
      transport: () => server,
    })
  }

  /** Leaves a database file behind, as a learner's file or a demo from earlier would be. */
  async function leave(d: ReturnType<typeof disk>, file: string, attachedTo: string | null = null): Promise<void> {
    const { boot: b } = boot({ openDriver: async () => d.openDriver(file) })
    await b.start()
    await ready(b).answer(hello)
    if (attachedTo) await ready(b).attachUser(attachedTo)
    await ready(b).close()
  }

  it('deletes other learners’ files and a demo not attached to the recorded learner before opening', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    await leave(d, learnerFile('u2'))
    await leave(d, DEMO_FILE)
    const accounts = accountStorage(memoryStorage())
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const { boot: b } = sweeping(d, accounts, server)
    await b.start()
    expect(b.store.get()).toMatchObject({ status: 'ready', account: { userId: 'u1' } })
    expect(await d.listDatabases()).toEqual([learnerFile('u1')])
  })

  it('keeps the demo, and deletes every learner’s file, without an account', async () => {
    const d = disk()
    const env = testEnv()
    await leave(d, learnerFile('u2'))
    await leave(d, DEMO_FILE)
    const { boot: b } = sweeping(d, accountStorage(memoryStorage()), new FakeServer({ now: env.now }))
    await b.start()
    expect(await d.listDatabases()).toEqual([DEMO_FILE])
    expect(ready(b).snapshot.states.size).toBe(1)
  })

  it('carries over a demo attached to the recorded learner even when the record lost its flag', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    await leave(d, DEMO_FILE, 'u1')
    const accounts = accountStorage(memoryStorage())
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const { boot: b } = sweeping(d, accounts, server)
    await b.start()
    expect(server.events.size).toBe(1)
    expect(await d.listDatabases()).toEqual([learnerFile('u1')])
    expect(accounts.read()).toEqual({ userId: 'u1', email: 'ana@example.com', carryOver: false })
  })
})

describe('the default L1 (plan 10)', () => {
  it('is Bulgarian for an account, and follows a German interface only in the demo', () => {
    const ana = { userId: 'u1', email: 'ana@example.com' }
    expect(defaultL1(null, 'de')).toBe('de')
    expect(defaultL1(null, 'bg')).toBe('bg')
    expect(defaultL1(null, 'en')).toBe('bg')
    expect(defaultL1(ana, 'de')).toBe('bg')
  })

  it('follows any interface that is an L1 the app teaches from, Spanish too (plan 12)', () => {
    const ana = { userId: 'u1', email: 'ana@example.com' }
    expect(defaultL1(null, 'es')).toBe('es')
    expect(defaultL1(null, 'de')).toBe('de')
    expect(defaultL1(ana, 'es')).toBe('bg')
  })

  it('opens the demo with a German interface in German, and a signed-in learner in Bulgarian', async () => {
    const accounts = accountStorage(memoryStorage())
    const asked: (string | null)[] = []
    const { boot: b } = boot({
      accounts,
      openDriver: fresh,
      l1: (account) => {
        asked.push(account?.userId ?? null)
        return defaultL1(account, 'de')
      },
    })
    await b.start()
    // A new demo opens in the setup (plan 11), whose Language page starts from the default.
    expect(b.store.get()).toMatchObject({ status: 'ready', setup: true })
    expect(ready(b).snapshot.l1).toBe('de')
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    await b.switchTo()
    expect(ready(b).snapshot.l1).toBe('bg')
    expect(ready(b).snapshot.corpus?.l1).toBe('bg')
    expect(asked).toContain(null)
    expect(asked.at(-1)).toBe('u1')
  })
})

/** A fetcher over the sample that records each pack it was asked for. */
function recordingFetcher(): { readonly fetchPack: PackFetcher; readonly fetched: string[] } {
  const fetched: string[] = []
  return {
    fetchPack: async (d) => {
      fetched.push(d.pack_id)
      return sampleFetcher(d)
    },
    fetched,
  }
}

/** A server holding what another device of the learner's has synced: `seed` runs on that device's Client first. */
async function seededServer(env: TestEnv, seed: (other: Client) => Promise<void>): Promise<FakeServer> {
  const server = new FakeServer({ now: env.now })
  const other = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg', transport: server })
  await seed(other)
  expect(await other.sync({ force: true })).toBe('synced')
  await other.close()
  return server
}

const ana = { userId: 'u1', email: 'ana@example.com' }

describe('the first-run setup (plan 11)', () => {
  it('opens a new demo in the setup without fetching a pack, prepares it, and leaves onReady to finishSetup', async () => {
    const calls: string[] = []
    const { fetchPack, fetched } = recordingFetcher()
    const { boot: b } = boot({
      openDriver: fresh,
      fetchPack,
      prepare: async () => {
        calls.push(`prepare while ${b.store.get().status}`)
      },
      onReady: async () => {
        calls.push('onReady')
      },
    })
    await b.start()
    expect(b.store.get()).toMatchObject({ status: 'ready', account: null, setup: true })
    expect(fetched).toEqual([])
    expect(ready(b).snapshot.corpus).toBeNull()
    expect(calls).toEqual(['prepare while starting'])

    const client = ready(b)
    expect(await client.changeL1('bg', sampleManifest, fetchPack)).toEqual({ ok: true })
    b.finishSetup()
    expect(b.store.get()).toMatchObject({ status: 'ready', setup: false })
    expect(ready(b)).toBe(client)
    await Promise.resolve()
    expect(calls).toEqual(['prepare while starting', 'onReady'])
    // Only once: a second call finds no setup to finish.
    b.finishSetup()
    await Promise.resolve()
    expect(calls).toEqual(['prepare while starting', 'onReady'])
  })

  it('opens a demo that already has a pack without the setup', async () => {
    const d = disk()
    const first = boot({ openDriver: d.openDriver })
    await first.boot.start()
    expect(await ready(first.boot).changeL1('bg', sampleManifest, sampleFetcher)).toEqual({ ok: true })
    await first.release()

    const again = boot({ openDriver: d.openDriver })
    await again.boot.start()
    expect(again.boot.store.get()).toMatchObject({ status: 'ready', setup: false })
    expect(ready(again.boot).snapshot.corpus?.l1).toBe('bg')
  })

  it('installs the chosen language without asking again when the tab closed during its download (Review Focus 3)', async () => {
    const d = disk()
    const first = boot({ openDriver: d.openDriver })
    await first.boot.start()
    await ready(first.boot).updateSettings({ l1: 'de' })
    await first.release()

    const { fetchPack, fetched } = recordingFetcher()
    const again = boot({ openDriver: d.openDriver, fetchPack })
    await again.boot.start()
    expect(again.boot.store.get()).toMatchObject({ status: 'ready', setup: false })
    expect(ready(again.boot).snapshot.corpus?.l1).toBe('de')
    expect(fetched).toEqual(['corpus-de'])
  })

  it('opens a new account in the setup once its first pull finds nothing, without fetching a pack', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    accounts.save(ana)
    const d = disk()
    const { fetchPack, fetched } = recordingFetcher()
    const log: string[] = []
    const { boot: b } = boot({
      env,
      accounts,
      openDriver: d.openDriver,
      transport: () => server,
      fetchPack,
      startSync: () => {
        log.push('start')
        return () => log.push('stop')
      },
    })
    await b.start()
    expect(b.store.get()).toMatchObject({ status: 'ready', account: { userId: 'u1' }, setup: true })
    expect(fetched).toEqual([])
    expect(ready(b).snapshot.corpus).toBeNull()
    expect(log).toEqual(['start'])
  })

  it('syncs an account at once when its setup finishes, so the chosen language reaches it (final review)', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    accounts.save(ana)
    const { boot: b } = boot({ env, accounts, openDriver: disk().openDriver, transport: () => server, startSync: () => () => undefined })
    await b.start()
    const client = ready(b)
    expect(await client.changeL1('de', sampleManifest, sampleFetcher)).toEqual({ ok: true })
    await client.updateSettings({ l1: 'de' })
    const sync = vi.spyOn(client, 'sync')
    b.finishSetup()
    expect(sync).toHaveBeenCalledTimes(1)
    await sync.mock.results[0]!.value
    const other = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg', transport: server })
    expect(await other.sync({ force: true })).toBe('synced')
    expect(other.snapshot.settings.l1).toBe('de')
    await other.close()
  })

  it('does not sync a demo when its setup finishes (final review)', async () => {
    const { boot: b } = boot({ openDriver: fresh })
    await b.start()
    const client = ready(b)
    expect(await client.changeL1('bg', sampleManifest, sampleFetcher)).toEqual({ ok: true })
    const sync = vi.spyOn(client, 'sync')
    b.finishSetup()
    expect(sync).not.toHaveBeenCalled()
  })

  it('installs a returning learner’s own language on a new device, without the setup', async () => {
    const env = testEnv()
    const server = await seededServer(env, async (other) => {
      await other.updateSettings({ l1: 'de' })
    })
    const accounts = accountStorage(memoryStorage())
    accounts.save(ana)
    const { fetchPack, fetched } = recordingFetcher()
    const { boot: b } = boot({ env, accounts, openDriver: disk().openDriver, transport: () => server, fetchPack })
    await b.start()
    expect(b.store.get()).toMatchObject({ status: 'ready', setup: false })
    expect(ready(b).snapshot.corpus?.l1).toBe('de')
    expect(fetched).toEqual(['corpus-de'])
  })

  it('installs Bulgarian, without the setup, for an account with progress from before plan 10 (Review Focus 2)', async () => {
    const env = testEnv()
    const server = await seededServer(env, async (other) => {
      await other.installPacks(sampleManifest, sampleFetcher)
      await other.startSession()
      await other.answer(hello)
    })
    expect(server.events.size).toBe(1)
    const accounts = accountStorage(memoryStorage())
    accounts.save(ana)
    const { fetchPack, fetched } = recordingFetcher()
    const { boot: b } = boot({ env, accounts, openDriver: disk().openDriver, transport: () => server, fetchPack })
    await b.start()
    expect(b.store.get()).toMatchObject({ status: 'ready', setup: false })
    expect(ready(b).snapshot.settings.l1).toBeNull()
    expect(ready(b).snapshot.corpus?.l1).toBe('bg')
    expect(fetched).toEqual(['corpus-bg'])
  })

  it('takes the ordinary path, installing the default language, when the first pull times out (Review Focus 1)', async () => {
    const hung = hangingServer()
    const accounts = accountStorage(memoryStorage())
    accounts.save(ana)
    const { fetchPack, fetched } = recordingFetcher()
    const delays = timerDelays()
    const { boot: b } = boot({ accounts, openDriver: disk().openDriver, transport: () => hung.transport, fetchPack, setupPullTimeoutMs: 20 })
    await b.start()
    expect(hung.calls).toContain('pull')
    expect(delays()).toContain(20)
    expect(delays()).not.toContain(SETUP_PULL_TIMEOUT_MS)
    expect(b.store.get()).toMatchObject({ status: 'ready', setup: false })
    expect(ready(b).snapshot.corpus?.l1).toBe('bg')
    expect(fetched).toEqual(['corpus-bg'])
  })

  it('takes the ordinary path when the first pull fails', async () => {
    const env = testEnv()
    const transport = flaky(new FakeServer({ now: env.now }))
    const accounts = accountStorage(memoryStorage())
    accounts.save(ana)
    const { boot: b } = boot({ env, accounts, openDriver: disk().openDriver, transport: () => transport })
    await b.start()
    expect(b.store.get()).toMatchObject({ status: 'ready', setup: false })
    expect(ready(b).snapshot.corpus?.l1).toBe('bg')
  })

  it('switches from a demo in the setup to a recorded account like any other switch (Review Focus 5)', async () => {
    const env = testEnv()
    const server = await seededServer(env, async (other) => {
      await other.updateSettings({ l1: 'de' })
    })
    const accounts = accountStorage(memoryStorage())
    const d = disk()
    const log: string[] = []
    const { boot: b } = boot({
      env,
      accounts,
      openDriver: d.openDriver,
      deleteDatabase: d.deleteDatabase,
      transport: () => server,
      startSync: () => {
        log.push('start')
        return () => log.push('stop')
      },
    })
    await b.start()
    expect(b.store.get()).toMatchObject({ status: 'ready', account: null, setup: true })
    const demo = ready(b)

    accounts.save(ana)
    expect(await b.switchTo({ deleteFiles: [DEMO_FILE] })).toBe(true)
    expect(b.store.get()).toMatchObject({ status: 'ready', account: { userId: 'u1' }, setup: false })
    expect(ready(b)).not.toBe(demo)
    expect(ready(b).snapshot.corpus?.l1).toBe('de')
    expect(d.exists(DEMO_FILE)).toBe(false)
    expect(log).toEqual(['start'])
    await expect(demo.updateSettings({ newWordLimit: 5 })).rejects.toThrow()
  })
})

describe('Boot never waits forever on the database (iOS: a frozen page holds the file)', () => {
  it('fails with the storage reason when opening the database never settles, and closes the driver if it arrives late', async () => {
    const late = deferred<{ driver: SqlDriver; backend: 'opfs' }>()
    const { driver, closes } = countingDriver(nodeSqliteDriver())
    let attempt = 0
    const delays = timerDelays()
    const signals: AbortSignal[] = []
    const { boot: b } = boot({
      openDriver: async (_file, signal) => {
        signals.push(signal!)
        attempt += 1
        return attempt === 1 ? late.promise : chosen()
      },
      openTimeoutMs: 20,
    })
    await b.start()
    expect(b.store.get()).toMatchObject({ status: 'failed', reason: 'storage' })
    expect(delays()).toContain(20)
    expect(delays()).not.toContain(OPEN_TIMEOUT_MS)
    expect(signals[0]!.aborted).toBe(true)
    late.resolve({ driver, backend: 'opfs' })
    await new Promise((r) => setTimeout(r, 0))
    expect(closes()).toBe(1)
    // "Try again" opens a fresh one.
    await b.retry()
    expect(ready(b).snapshot.corpus).not.toBeNull()
    // An open that finished in time is not cancelled.
    expect(signals[1]!.aborted).toBe(false)
  })

  it('skips a demo it cannot open in time, for the sweep and an owed carry-over, and opens the learner’s file', async () => {
    const d = disk()
    const env = testEnv()
    await (async () => {
      const { boot: first } = boot({ openDriver: async () => d.openDriver(DEMO_FILE) })
      await first.start()
      await ready(first).answer(hello)
      await ready(first).close()
    })()
    const accounts = accountStorage(memoryStorage())
    accounts.save({ userId: 'u1', email: 'ana@example.com', carryOver: true })
    const { boot: b } = boot({
      env,
      accounts,
      openDriver: async (file) => (file === DEMO_FILE ? new Promise(() => undefined) : choosing(d.openDriver)(file)),
      deleteDatabase: d.deleteDatabase,
      listDatabases: d.listDatabases,
      transport: () => new FakeServer({ now: env.now }),
      openTimeoutMs: 20,
      setupPullTimeoutMs: 20,
    })
    await b.start()
    expect(b.store.get()).toMatchObject({ status: 'ready', account: { userId: 'u1' } })
    // The carry-over is still owed: the demo stays, and so does the flag.
    expect(d.exists(DEMO_FILE)).toBe(true)
    expect(accounts.read()?.carryOver).toBe(true)
  })
})

describe('Boot lets go when the page is hidden, and opens again when it is shown (iOS back-forward cache)', () => {
  it('suspend() ends the database at once, lets go of the lock, and drops the Client; resume() opens a fresh one', async () => {
    const opened: ReturnType<typeof countingDriver>[] = []
    const log: string[] = []
    const { boot: b, locks } = boot({
      openDriver: async () => {
        const { driver } = await chosen()
        const counted = countingDriver(driver)
        opened.push(counted)
        return { driver: counted.driver, backend: 'opfs' }
      },
      terminateDrivers: () => void log.push(`terminate while ${b.store.get().status}`),
    })
    await b.start()
    const client = ready(b)
    locks.length = 0

    b.suspend()
    // Synchronous: a page about to be frozen gets no later turn.
    expect(log).toEqual(['terminate while ready'])
    expect(locks).toEqual(['drop'])
    expect(b.store.get().status).toBe('starting')
    await new Promise((r) => setTimeout(r, 0))
    expect(opened[0]!.closes()).toBe(1)
    await expect(client.updateSettings({ newWordLimit: 5 })).rejects.toThrow()

    await b.resume()
    expect(locks).toEqual(['drop', 'acquire'])
    expect(opened).toHaveLength(2)
    expect(ready(b)).not.toBe(client)
    expect(ready(b).snapshot.corpus).not.toBeNull()
  })

  it('an open in flight when the page is hidden never becomes ready, and its driver is closed', async () => {
    const first = deferred<{ driver: SqlDriver; backend: 'opfs' }>()
    const entered = deferred<void>()
    const { driver, closes } = countingDriver(nodeSqliteDriver())
    let attempt = 0
    const { boot: b } = boot({
      openDriver: async () => {
        attempt += 1
        if (attempt > 1) return chosen()
        entered.resolve()
        return first.promise
      },
    })
    const starting = b.start()
    await entered.promise
    b.suspend()
    first.resolve({ driver, backend: 'opfs' })
    await starting
    expect(b.store.get().status).toBe('starting')
    expect(closes()).toBe(1)
    await b.resume()
    expect(ready(b).snapshot.corpus).not.toBeNull()
  })

  it('a lock request answered after the page was hidden lets the lock go again and opens nothing; resume() opens once', async () => {
    const held = deferred<boolean>()
    const log: string[] = []
    let acquires = 0
    const env = testEnv()
    const accounts = accountStorage(memoryStorage())
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const lock: LockPort = {
      acquire: () => (++acquires === 1 ? held.promise : Promise.resolve(true)),
      takeOver: async () => undefined,
      drop: () => void log.push('drop'),
    }
    const b = new Boot(
      {
        env,
        l1: () => 'bg',
        accounts,
        openDriver: async (file) => {
          log.push(`open ${file}`)
          return chosen()
        },
        transport: () => new FakeServer({ now: env.now }),
        startSync: () => {
          log.push('startSync')
          return () => log.push('stopSync')
        },
        fetchManifest: async () => sampleManifest,
        fetchPack: sampleFetcher,
      },
      () => lock,
    )
    const starting = b.start()
    b.suspend()
    log.length = 0
    held.resolve(true)
    await starting
    expect(b.store.get().status).toBe('starting')
    expect(log).toEqual(['drop'])
    await b.resume()
    expect(b.store.get()).toMatchObject({ status: 'ready', account: { userId: 'u1' } })
    expect(log).toEqual(['drop', `open ${learnerFile('u1')}`, 'startSync'])
  })

  it('a take-over answered after the page was hidden lets the lock go again and opens nothing', async () => {
    const taken = deferred<void>()
    const log: string[] = []
    const lock: LockPort = {
      acquire: async () => false,
      takeOver: () => taken.promise,
      drop: () => void log.push('drop'),
    }
    const b = new Boot(
      {
        env: testEnv(),
        l1: () => 'bg',
        openDriver: async (file) => {
          log.push(`open ${file}`)
          return chosen()
        },
        fetchManifest: async () => sampleManifest,
        fetchPack: sampleFetcher,
      },
      () => lock,
    )
    await b.start()
    const takingOver = b.takeOver()
    b.suspend()
    log.length = 0
    taken.resolve()
    await takingOver
    expect(b.store.get().status).toBe('starting')
    expect(log).toEqual(['drop'])
  })

  it('a stale take-over sharing its request with a newer one leaves the lock to it: held, and opened once', async () => {
    // TabLock.takeOver() hands every caller the one request in flight.
    const taken = deferred<void>()
    const log: string[] = []
    const lock: LockPort = {
      acquire: async () => false,
      takeOver: () => taken.promise,
      drop: () => void log.push('drop'),
    }
    const b = new Boot(
      {
        env: testEnv(),
        l1: () => 'bg',
        openDriver: async (file) => {
          log.push(`open ${file}`)
          return chosen()
        },
        fetchManifest: async () => sampleManifest,
        fetchPack: sampleFetcher,
      },
      () => lock,
    )
    await b.start()
    const stale = b.takeOver()
    b.suspend()
    await b.resume()
    expect(b.store.get().status).toBe('elsewhere')
    log.length = 0
    const current = b.takeOver()
    taken.resolve()
    await Promise.all([stale, current])
    expect(log).toEqual([`open ${DEMO_FILE}`])
    expect(ready(b).snapshot.corpus).not.toBeNull()
  })

  it('resume() does nothing while leave() is still letting go; after it, the page reopens as usual', async () => {
    const closing = deferred<void>()
    let opens = 0
    const { boot: b, locks } = boot({
      openDriver: async () => {
        opens += 1
        const { driver } = await chosen()
        if (opens > 1) return { driver, backend: 'opfs' }
        return { driver: { ...driver, close: async () => (await closing.promise, driver.close()) }, backend: 'opfs' }
      },
    })
    await b.start()
    const leaving = b.leave()
    await b.resume()
    expect(locks).toEqual(['acquire'])
    expect(b.store.get().status).toBe('starting')
    closing.resolve()
    await leaving
    b.suspend()
    await b.resume()
    expect(opens).toBe(2)
    expect(ready(b).snapshot.corpus).not.toBeNull()
  })

  it('a hand-over that waited for an open does not close the Client a later resume() opened', async () => {
    const first = deferred<{ driver: SqlDriver; backend: 'opfs' }>()
    const entered = deferred<void>()
    let attempt = 0
    const { boot: b, release } = boot({
      openDriver: async () => {
        attempt += 1
        if (attempt > 1) return chosen()
        entered.resolve()
        return first.promise
      },
    })
    const starting = b.start()
    await entered.promise
    const releasing = release()
    b.suspend()
    await b.resume()
    const client = ready(b)
    first.resolve({ driver: nodeSqliteDriver(), backend: 'opfs' })
    await Promise.all([starting, releasing])
    expect(ready(b)).toBe(client)
    await client.updateSettings({ newWordLimit: 5 })
  })

  it('resume() does nothing unless the Boot was suspended', async () => {
    let opens = 0
    const { boot: b } = boot({
      openDriver: async () => {
        opens += 1
        return chosen()
      },
    })
    await b.start()
    const client = ready(b)
    await b.resume()
    expect(opens).toBe(1)
    expect(ready(b)).toBe(client)
  })

  it('leave() flushes and closes as a hand-over does, then lets go of the lock; resume() opens again', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const log: string[] = []
    const { boot: b, locks } = boot({
      env,
      accounts,
      openDriver: async (file) => {
        const opened = await choosing(d.openDriver)(file)
        return { ...opened, driver: { ...opened.driver, close: async () => (log.push('closed'), opened.driver.close()) } }
      },
      deleteDatabase: d.deleteDatabase,
      transport: () => server,
    })
    await b.start()
    const client = ready(b)
    await client.answer(hello)
    locks.length = 0
    const leaving = b.leave()
    expect(b.store.get().status).toBe('starting')
    await leaving
    expect(server.events.size).toBe(1)
    expect(log).toEqual(['closed'])
    expect(locks).toEqual(['drop'])
    expect(b.store.get().status).toBe('starting')

    await b.resume()
    expect(ready(b)).not.toBe(client)
    expect(ready(b).snapshot.states.size).toBe(1)
  })
})
