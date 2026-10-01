import { createStore, type ChangeL1Outcome, type Client, type PackFetcher, type Store } from '@wordado/client-data'
import type { L1, PackManifest } from '@wordado/core'
import type { AccountRecord } from '../account/storage'

export type PackSwitchState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'downloading'; readonly l1: L1; readonly received: number; readonly total: number }
  | { readonly phase: 'failed'; readonly l1: L1 }

export interface PackSwitchDeps {
  fetchManifest(account: AccountRecord | null): Promise<PackManifest>
  /** A fetcher that reports its progress: `packFetcher(undefined, onProgress)` in the app. */
  fetcher(onProgress: (received: number, total: number) => void): PackFetcher
}

/**
 * The one place that installs a language's pack (plan 11, Task 3): the L1 watcher, the setup's Language step and
 * Settings' native-language page all go through this. One install runs at a time; a call for the L1 already being
 * installed joins it, and a call for another L1 waits its turn.
 */
export class PackSwitcher {
  readonly store: Store<PackSwitchState> = createStore<PackSwitchState>({ phase: 'idle' })
  private running: { readonly l1: L1; readonly promise: Promise<ChangeL1Outcome> } | null = null
  /** The queue: each install chains onto this, whatever its own outcome, so the next one always gets its turn. */
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly deps: PackSwitchDeps) {}

  install(client: Client, account: AccountRecord | null, l1: L1): Promise<ChangeL1Outcome> {
    const joining = this.running
    if (joining && joining.l1 === l1) return joining.promise

    const after = this.queue
    const promise: Promise<ChangeL1Outcome> = after.then(() => this.run(client, account, l1))
    this.running = { l1, promise }
    this.queue = promise.then(
      () => undefined,
      () => undefined,
    )
    void promise.finally(() => {
      if (this.running?.promise === promise) this.running = null
    })
    return promise
  }

  /** Back to idle (the setup's "Try again" first clears a failure). */
  reset(): void {
    this.store.set({ phase: 'idle' })
  }

  private async run(client: Client, account: AccountRecord | null, l1: L1): Promise<ChangeL1Outcome> {
    try {
      const manifest = await this.deps.fetchManifest(account)
      const fetchPack = this.deps.fetcher((received, total) => this.store.set({ phase: 'downloading', l1, received, total }))
      const outcome = await client.changeL1(l1, manifest, fetchPack)
      this.store.set(outcome.ok ? { phase: 'idle' } : { phase: 'failed', l1 })
      return outcome
    } catch {
      this.store.set({ phase: 'failed', l1 })
      return { ok: false, reason: 'unavailable' }
    }
  }
}
