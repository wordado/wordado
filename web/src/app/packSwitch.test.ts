import type { ChangeL1Outcome, Client, PackFetcher } from '@wordado/client-data'
import type { L1, PackDescriptor, PackManifest } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import type { AccountRecord } from '../account/storage'
import { PackSwitcher } from './packSwitch'

const descriptor = (l1: L1): PackDescriptor => ({ pack_id: `corpus-${l1}`, l1, corpus_version: 1, schema_version: 1, url: `${l1}.pack`, sha256: '', bytes: 100 })
const manifestFor = (l1: L1): PackManifest => ({ schema_version: 1, corpus_version: 1, packs: [descriptor(l1)] })

/** A fake client whose `changeL1` calls the `fetchPack` it is given, so the switcher's progress plumbing is exercised. */
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
  it('publishes progress while downloading, then idle on success, and resolves ok', async () => {
    const switcher = harness({ reports: [[0, 100], [50, 100], [100, 100]] })
    const { client } = fakeClient()
    const seen: unknown[] = []
    switcher.store.subscribe(() => seen.push(switcher.store.get()))
    const outcome = await switcher.install(client, null, 'bg')
    expect(outcome).toEqual({ ok: true })
    expect(seen).toEqual([
      { phase: 'downloading', l1: 'bg', received: 0, total: 100 },
      { phase: 'downloading', l1: 'bg', received: 50, total: 100 },
      { phase: 'downloading', l1: 'bg', received: 100, total: 100 },
      { phase: 'idle' },
    ])
    expect(switcher.store.get()).toEqual({ phase: 'idle' })
  })

  it('joins a call for the L1 already being installed: changeL1 runs once, both resolve with the same outcome', async () => {
    const switcher = harness()
    const { client, calls } = fakeClient()
    const first = switcher.install(client, null, 'de')
    const second = switcher.install(client, null, 'de')
    const [a, b] = await Promise.all([first, second])
    expect(calls).toEqual(['de'])
    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
  })

  it('queues a call for another L1: it waits for the running install, then runs, in order', async () => {
    const switcher = harness()
    const { client, calls } = fakeClient()
    const first = switcher.install(client, null, 'de')
    const second = switcher.install(client, null, 'bg')
    await Promise.all([first, second])
    expect(calls).toEqual(['de', 'bg'])
  })

  it('never throws: a failing manifest fetch resolves unavailable and leaves the store failed; reset returns it to idle', async () => {
    const switcher = harness({ fetchManifest: () => Promise.reject(new Error('offline')) })
    const { client } = fakeClient()
    const outcome = await switcher.install(client, null, 'de')
    expect(outcome).toEqual({ ok: false, reason: 'unavailable' })
    expect(switcher.store.get()).toEqual({ phase: 'failed', l1: 'de' })
    switcher.reset()
    expect(switcher.store.get()).toEqual({ phase: 'idle' })
  })
})
