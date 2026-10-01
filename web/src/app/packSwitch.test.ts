import { ClientClosed, type ChangeL1Outcome, type Client, type PackFetcher } from '@wordado/client-data'
import type { L1, PackDescriptor, PackManifest } from '@wordado/core'
import { describe, expect, it, vi } from 'vitest'
import type { AccountRecord } from '../account/storage'
import { PackSwitcher } from './packSwitch'

const descriptor = (l1: L1): PackDescriptor => ({ pack_id: `corpus-${l1}`, l1, corpus_version: 1, schema_version: 1, url: `${l1}.pack`, sha256: '', bytes: 100 })
const manifestFor = (l1: L1): PackManifest => ({ schema_version: 1, corpus_version: 1, packs: [descriptor(l1)] })

/** Lets microtask chains (promise joins, `.then` callbacks) settle before the next assertion. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

/** A fake client whose `changeL1` calls the `fetchPack` it is given, so the switcher's progress plumbing is exercised. Resolves at once. */
function fakeClient(outcomes: Partial<Record<L1, ChangeL1Outcome>> = {}): { readonly calls: L1[]; readonly client: Client } {
  const calls: L1[] = []
  const client = {
    changeL1: async (l1: L1, manifest: PackManifest, fetchPack: PackFetcher) => {
      calls.push(l1)
      await fetchPack(manifest.packs[0]!)
      return outcomes[l1] ?? { ok: true }
    },
  } as unknown as Client
  return { calls, client }
}

/**
 * A fake client whose `changeL1` records the call, then hangs until the test settles it explicitly. This is what
 * actually proves installs queue (plan 11 review, I1): with `fakeClient` above every call resolves on its own, so an
 * un-queued, fire-both-at-once implementation would show the same call order by coincidence.
 */
function deferredClient(): {
  readonly client: Client
  readonly calls: L1[]
  settle(l1: L1, outcome: ChangeL1Outcome): void
  fail(l1: L1, error: unknown): void
} {
  const calls: L1[] = []
  const pending: { readonly l1: L1; resolve(o: ChangeL1Outcome): void; reject(e: unknown): void }[] = []
  const client = {
    changeL1: async (l1: L1, manifest: PackManifest, fetchPack: PackFetcher) => {
      calls.push(l1)
      await fetchPack(manifest.packs[0]!)
      return new Promise<ChangeL1Outcome>((resolve, reject) => pending.push({ l1, resolve, reject }))
    },
  } as unknown as Client
  const next = (l1: L1) => {
    const entry = pending.shift()
    if (!entry || entry.l1 !== l1) throw new Error(`expected the oldest pending changeL1 to be for '${l1}', found '${entry?.l1 ?? 'none'}'`)
    return entry
  }
  return {
    client,
    calls,
    settle: (l1, outcome) => next(l1).resolve(outcome),
    fail: (l1, error) => next(l1).reject(error),
  }
}

/** A fetcher that reports the progress a test hands it, then resolves. */
function fakeFetcher(reports: readonly [number, number][] = [[0, 100], [100, 100]]) {
  return (onProgress: (received: number, total: number) => void): PackFetcher =>
    async (d) => {
      for (const [received, total] of reports) onProgress(received, total)
      return new Uint8Array(d.bytes)
    }
}

function harness(options: { readonly reports?: readonly [number, number][]; readonly fetchManifest?: (account: AccountRecord | null) => Promise<PackManifest> } = {}) {
  const switcher = new PackSwitcher({
    fetchManifest: options.fetchManifest ?? ((account) => Promise.resolve(manifestFor(account ? 'de' : 'bg'))),
    fetcher: fakeFetcher(options.reports),
  })
  return switcher
}

describe('PackSwitcher (plan 11)', () => {
  it('publishes a zeroed download at once, then the fetcher\'s progress, then idle on success, and resolves ok', async () => {
    const switcher = harness({ reports: [[0, 100], [50, 100], [100, 100]] })
    const { client } = fakeClient()
    const seen: unknown[] = []
    switcher.store.subscribe(() => seen.push(switcher.store.get()))
    const outcome = await switcher.install(client, null, 'bg')
    expect(outcome).toEqual({ ok: true })
    expect(seen).toEqual([
      { phase: 'downloading', client, l1: 'bg', received: 0, total: 0 },
      { phase: 'downloading', client, l1: 'bg', received: 0, total: 100 },
      { phase: 'downloading', client, l1: 'bg', received: 50, total: 100 },
      { phase: 'downloading', client, l1: 'bg', received: 100, total: 100 },
      { phase: 'idle' },
    ])
    expect(switcher.store.get()).toEqual({ phase: 'idle' })
  })

  it('joins a call for the same client and L1 already being installed: changeL1 runs once, both resolve with the same outcome', async () => {
    const switcher = harness()
    const { client, calls } = fakeClient()
    const first = switcher.install(client, null, 'de')
    const second = switcher.install(client, null, 'de')
    const [a, b] = await Promise.all([first, second])
    expect(calls).toEqual(['de'])
    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
  })

  it('joins only when the client matches too: a same-L1 call for a different client queues instead of joining', async () => {
    const switcher = harness()
    const first = deferredClient()
    const second = deferredClient()
    const a = switcher.install(first.client, null, 'de')
    const b = switcher.install(second.client, null, 'de')
    await flush()
    // Still only the first client's install has started; the second is queued behind it, not joined.
    expect(first.calls).toEqual(['de'])
    expect(second.calls).toEqual([])
    first.settle('de', { ok: true })
    await vi.waitFor(() => expect(second.calls).toEqual(['de']))
    second.settle('de', { ok: true })
    expect(await a).toEqual({ ok: true })
    expect(await b).toEqual({ ok: true })
  })

  it('queues a call for another L1: changeL1 for it is not called until the running install settles', async () => {
    const switcher = harness()
    const d = deferredClient()
    const first = switcher.install(d.client, null, 'de')
    const second = switcher.install(d.client, null, 'bg')
    await flush()
    // Proves the queue, not coincidence: 'bg' must not have been called while 'de' is still pending.
    expect(d.calls).toEqual(['de'])
    d.settle('de', { ok: true })
    await vi.waitFor(() => expect(d.calls).toEqual(['de', 'bg']))
    d.settle('bg', { ok: true })
    expect(await first).toEqual({ ok: true })
    expect(await second).toEqual({ ok: true })
  })

  it('queues several calls behind the running install, and runs each in order once the one before it settles', async () => {
    const switcher = harness()
    const d = deferredClient()
    const first = switcher.install(d.client, null, 'de')
    const second = switcher.install(d.client, null, 'bg')
    const third = switcher.install(d.client, null, 'de')
    await flush()
    expect(d.calls).toEqual(['de'])
    d.settle('de', { ok: true })
    await vi.waitFor(() => expect(d.calls).toEqual(['de', 'bg']))
    d.settle('bg', { ok: true })
    await vi.waitFor(() => expect(d.calls).toEqual(['de', 'bg', 'de']))
    d.settle('de', { ok: true })
    await Promise.all([first, second, third])
  })

  it('a changeL1 that throws does not block the queue, and a later call for the same L1 runs again rather than joining the dead promise', async () => {
    const switcher = harness()
    const d = deferredClient()
    const first = switcher.install(d.client, null, 'de')
    const second = switcher.install(d.client, null, 'bg')
    await flush()
    expect(d.calls).toEqual(['de'])
    d.fail('de', new Error('boom'))
    expect(await first).toEqual({ ok: false, reason: 'unavailable' })
    // The queue still reaches 'bg' despite 'de' throwing.
    await vi.waitFor(() => expect(d.calls).toEqual(['de', 'bg']))
    d.settle('bg', { ok: true })
    expect(await second).toEqual({ ok: true })

    // 'de' already settled (with a failure): a fresh call for it must run again, not join that dead promise.
    const third = switcher.install(d.client, null, 'de')
    await vi.waitFor(() => expect(d.calls).toEqual(['de', 'bg', 'de']))
    d.settle('de', { ok: true })
    expect(await third).toEqual({ ok: true })
  })

  it('names the client in every downloading and failed state, so a screen shows only its own (final review)', async () => {
    const switcher = harness({ reports: [[50, 100]] })
    const first = fakeClient({ de: { ok: false, reason: 'unsupported' } }).client
    const second = fakeClient().client
    const seen: unknown[] = []
    switcher.store.subscribe(() => seen.push(switcher.store.get()))
    await switcher.install(first, null, 'de')
    await switcher.install(second, null, 'de')
    expect(seen).toEqual([
      { phase: 'downloading', client: first, l1: 'de', received: 0, total: 0 },
      { phase: 'downloading', client: first, l1: 'de', received: 50, total: 100 },
      { phase: 'failed', client: first, l1: 'de' },
      { phase: 'downloading', client: second, l1: 'de', received: 0, total: 0 },
      { phase: 'downloading', client: second, l1: 'de', received: 50, total: 100 },
      { phase: 'idle' },
    ])
  })

  it('a changeL1 that returns ok:false leaves the store failed with that L1', async () => {
    const switcher = harness()
    const { client } = fakeClient({ de: { ok: false, reason: 'unsupported' } })
    const outcome = await switcher.install(client, null, 'de')
    expect(outcome).toEqual({ ok: false, reason: 'unsupported' })
    expect(switcher.store.get()).toEqual({ phase: 'failed', client, l1: 'de' })
  })

  it('never throws: a failing manifest fetch resolves unavailable and leaves the store failed; reset returns it to idle', async () => {
    const switcher = harness({ fetchManifest: () => Promise.reject(new Error('offline')) })
    const { client } = fakeClient()
    const outcome = await switcher.install(client, null, 'de')
    expect(outcome).toEqual({ ok: false, reason: 'unavailable' })
    expect(switcher.store.get()).toEqual({ phase: 'failed', client, l1: 'de' })
    switcher.reset()
    expect(switcher.store.get()).toEqual({ phase: 'idle' })
  })

  it('treats a closed client (an account switched away mid-install) as no failure: idle, not a stale failed, resolved unavailable', async () => {
    const switcher = harness()
    const client = { changeL1: async () => Promise.reject(new ClientClosed()) } as unknown as Client
    const outcome = await switcher.install(client, null, 'de')
    expect(outcome).toEqual({ ok: false, reason: 'unavailable' })
    expect(switcher.store.get()).toEqual({ phase: 'idle' })
  })
})
