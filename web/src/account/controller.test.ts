import { FakeServer } from '@wordado/client-data/src/testing/fakeServer'
import { sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import { testEnv, type TestEnv } from '@wordado/client-data/src/testing/testEnv'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { Client, type SyncTransport } from '@wordado/client-data'
import type { WordId } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Boot, type LockPort } from '../app/boot'
import { answerTo, disk, flaky } from '../test/disk'
import { fakeApi } from '../test/fakeApi'
import type { Me } from './api'
import { AccountController } from './controller'
import { accountStorage, DEMO_FILE, learnerFile, memoryStorage, pendingSignIn } from './storage'

const ANA: Me = { userId: 'u1', email: 'ana@example.com', country: null, createdAt: 0 }

/** A booted app on disk over a fake server, and its controller. */
async function app(options: { env?: TestEnv; server?: FakeServer; transport?: SyncTransport; session?: Me | null } = {}) {
  const env = options.env ?? testEnv()
  const server = options.server ?? new FakeServer({ now: env.now })
  const transport = options.transport ?? server
  const d = disk()
  const accounts = accountStorage(memoryStorage())
  const pending = pendingSignIn(memoryStorage())
  const api = fakeApi({}, options.session === undefined ? ANA : options.session)
  const stops: boolean[] = []
  const lock: LockPort = { acquire: async () => true, takeOver: async () => undefined }
  const boot = new Boot(
    { env, l1: 'bg', accounts, openDriver: d.openDriver, deleteDatabase: d.deleteDatabase, transport: () => transport, fetchManifest: async () => sampleManifest, fetchPack: sampleFetcher },
    () => lock,
  )
  await boot.start()
  const controller = new AccountController({
    api,
    boot,
    accounts,
    pending,
    transport: () => transport,
    reminders: {
      stop: async ({ server: s }) => {
        stops.push(s)
      },
    },
  })
  const client = () => {
    const state = boot.store.get()
    if (state.status !== 'ready') throw new Error(`not ready: ${state.status}`)
    return state.client
  }
  return { env, server, d, accounts, pending, api, boot, controller, client, stops }
}

/** Another device of the same account, with progress on the server. */
async function progressElsewhere(env: TestEnv, server: FakeServer): Promise<void> {
  const other = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg', transport: server })
  await other.installPacks(sampleManifest, sampleFetcher)
  await other.startSession()
  await other.answer(answerTo('c:goodbye-1'))
  await other.sync()
  await other.close()
}

describe('signing in from the demo (spec §8.6)', () => {
  it('carries the demo over into a new account, from the demo’s own device, and deletes the demo', async () => {
    const a = await app()
    const demoDevice = a.client().snapshot.deviceId
    await a.client().answer(answerTo('c:hello-1'))
    expect(await a.controller.completeSignIn('BG')).toBe('carried-over')
    expect([...a.server.events.values()].map((e) => [e.wordId, e.deviceId])).toEqual([['c:hello-1', demoDevice]])
    expect(a.d.exists(DEMO_FILE)).toBe(false)
    expect(a.accounts.read()).toEqual({ userId: 'u1', email: 'ana@example.com', carryOver: false })
    expect(a.boot.store.get()).toMatchObject({ status: 'ready', account: { userId: 'u1' } })
    expect(await a.client().sync()).toBe('synced')
    expect(a.client().snapshot.states.get('c:hello-1' as WordId)?.reps).toBe(1)
    expect(a.controller.store.get()).toEqual({ expired: false, notice: 'carried-over' })
    expect(a.api.calls).toContain('setCountry BG')
  })

  it('discards the demo when the account already has progress, and merges nothing', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    await progressElsewhere(env, server)
    const a = await app({ env, server })
    await a.client().answer(answerTo('c:hello-1'))
    expect(await a.controller.completeSignIn(null)).toBe('demo-discarded')
    expect([...server.events.values()].map((e) => e.wordId)).toEqual(['c:goodbye-1'])
    expect(a.d.exists(DEMO_FILE)).toBe(false)
    expect(await a.client().sync()).toBe('synced')
    expect([...a.client().snapshot.states.keys()]).toEqual(['c:goodbye-1'])
    expect(a.api.calls).not.toContain('setCountry null')
  })

  it('deletes an untouched demo and simply signs in', async () => {
    const a = await app()
    expect(await a.controller.completeSignIn('BG')).toBe('signed-in')
    expect(a.d.exists(DEMO_FILE)).toBe(false)
    expect(a.server.events.size).toBe(0)
  })

  it('keeps the demo attached when its push fails, and says the carry-over is owed', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const transport = flaky(server)
    const a = await app({ env, server, transport })
    await a.client().answer(answerTo('c:hello-1'))
    // Online for the emptiness check, offline for the push: the tab loses its connection at the worst moment.
    transport.online = true
    const push = transport.push
    transport.push = () => Promise.reject(new Error('offline'))
    expect(await a.controller.completeSignIn('BG')).toBe('carried-over')
    expect(a.accounts.read()?.carryOver).toBe(true)
    expect(a.d.exists(DEMO_FILE)).toBe(true)
    transport.push = push
    await a.boot.switchTo()
    expect(server.events.size).toBe(1)
    expect(a.d.exists(DEMO_FILE)).toBe(false)
  })

  it('changes nothing when the account cannot be checked (offline)', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const a = await app({ env, server, transport: flaky(server) })
    await a.client().answer(answerTo('c:hello-1'))
    await expect(a.controller.completeSignIn('BG')).rejects.toThrow('offline')
    expect(a.accounts.read()).toBeNull()
    expect(a.boot.store.get()).toMatchObject({ status: 'ready', account: null })
  })

  it('does nothing without a session', async () => {
    const a = await app({ session: null })
    await expect(a.controller.completeSignIn('BG')).rejects.toThrow()
    expect(a.accounts.read()).toBeNull()
  })
})

describe('signing in again (spec §8.6)', () => {
  it('clears an expired sign-in for the same learner and syncs at once', async () => {
    const a = await app()
    await a.controller.completeSignIn('BG')
    a.controller.sessionExpired()
    expect(a.controller.store.get().expired).toBe(true)
    await a.client().answer(answerTo('c:hello-1'))
    expect(await a.controller.completeSignIn(null)).toBe('signed-in')
    expect(a.controller.store.get()).toEqual({ expired: false, notice: 'signed-in' })
    await a.client().idle()
    await a.client().sync()
    expect(a.server.events.size).toBe(1)
  })

  it('refuses another account on a device that holds a learner’s progress, and signs that session out', async () => {
    const a = await app()
    await a.controller.completeSignIn('BG')
    a.api.session = { ...ANA, userId: 'u2', email: 'bo@example.com' }
    expect(await a.controller.completeSignIn('BG')).toBe('other-account')
    expect(a.api.calls.at(-1)).toBe('signOut')
    expect(a.accounts.read()?.userId).toBe('u1')
    expect(a.boot.store.get()).toMatchObject({ status: 'ready', account: { userId: 'u1' } })
  })

  it('marks the sign-in as expired only when signed in', async () => {
    const a = await app()
    a.controller.sessionExpired()
    expect(a.controller.store.get().expired).toBe(false)
  })
})

describe('Google’s return (spec §8.6)', () => {
  it('completes with the age gate’s country carried across the redirect', async () => {
    const a = await app()
    a.pending.save({ country: 'DE' })
    expect(await a.controller.resumeGoogle('ok')).toBe('signed-in')
    expect(a.api.calls).toContain('setCountry DE')
    expect(a.pending.read()).toBeNull()
  })

  it('does not complete a sign-in whose age gate was not passed in this tab', async () => {
    const a = await app()
    expect(await a.controller.resumeGoogle('ok')).toBeNull()
    expect(a.api.calls).toContain('signOut')
    expect(a.accounts.read()).toBeNull()
    expect(a.controller.store.get().notice).toBe('google-failed')
  })

  it('says so when Google sent the learner back with an error', async () => {
    const a = await app()
    a.pending.save({ country: 'BG' })
    expect(await a.controller.resumeGoogle('error')).toBeNull()
    expect(a.controller.store.get().notice).toBe('google-failed')
  })
})

describe('signing out, deleting, leaving the demo (spec §8.6, §11)', () => {
  it('asks before losing answers that could not be flushed, then signs out and deletes the learner’s file', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const transport = flaky(server)
    transport.online = true
    const a = await app({ env, server, transport })
    await a.controller.completeSignIn('BG')
    transport.online = false
    await a.client().answer(answerTo('c:hello-1'))
    expect(await a.controller.signOut()).toBe('unsynced')
    expect(a.accounts.read()?.userId).toBe('u1')
    expect(await a.controller.signOut({ force: true })).toBe('signed-out')
    expect(a.accounts.read()).toBeNull()
    expect(a.d.exists(learnerFile('u1'))).toBe(false)
    expect(a.boot.store.get()).toMatchObject({ status: 'ready', account: null })
    expect(a.client().snapshot.states.size).toBe(0)
    expect(a.stops).toEqual([true])
    expect(a.api.calls).toContain('signOut')
  })

  it('signs out without asking when everything is synced', async () => {
    const a = await app()
    await a.controller.completeSignIn('BG')
    await a.client().answer(answerTo('c:hello-1'))
    expect(await a.controller.signOut()).toBe('signed-out')
    expect(a.server.events.size).toBe(1)
  })

  it('deletes the account on the server first, and changes nothing here when that fails', async () => {
    const a = await app()
    await a.controller.completeSignIn('BG')
    a.api.deleteAccount = async () => Promise.reject(new Error('offline'))
    await expect(a.controller.deleteAccount()).rejects.toThrow('offline')
    expect(a.accounts.read()?.userId).toBe('u1')
    expect(a.d.exists(learnerFile('u1'))).toBe(true)
  })

  it('deletes the account, then the learner’s file, and opens a fresh demo', async () => {
    const a = await app()
    await a.controller.completeSignIn('BG')
    await a.controller.deleteAccount()
    expect(a.accounts.read()).toBeNull()
    expect(a.d.exists(learnerFile('u1'))).toBe(false)
    expect(a.boot.store.get()).toMatchObject({ status: 'ready', account: null })
    expect(a.controller.store.get().notice).toBe('deleted')
    expect(a.stops).toEqual([false])
  })

  it('leaves the demo: its progress is deleted and a fresh one opens', async () => {
    const a = await app()
    await a.client().answer(answerTo('c:hello-1'))
    await a.controller.leaveDemo()
    expect(a.client().snapshot.states.size).toBe(0)
    expect(a.controller.store.get().notice).toBe('demo-left')
  })
})
