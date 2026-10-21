import { ClientClosed, createStore, type ChangeL1Outcome, type Client, type PackFetcher, type Store } from '@wordado/client-data'
import type { Course, PackManifest, Target } from '@wordado/core'
import type { AccountRecord } from '../account/storage'

/** A download or failure names its client, so a screen shows only its own (a demo's and an account's can overlap). */
export type PackSwitchState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'downloading'; readonly client: Client; readonly course: Course; readonly received: number; readonly total: number }
  | { readonly phase: 'failed'; readonly client: Client; readonly course: Course }

/** The same course: its target and its L1. */
export function sameCourse(a: Course, b: Course): boolean {
  return a.target === b.target && a.l1 === b.l1
}

export interface PackSwitchDeps {
  /** The manifest of the account's (or a visitor's) packs for `target`'s course. */
  fetchManifest(account: AccountRecord | null, target: Target): Promise<PackManifest>
  /** A fetcher that reports its progress: `packFetcher(undefined, onProgress)` in the app. */
  fetcher(onProgress: (received: number, total: number) => void): PackFetcher
}

/**
 * The one place that installs a course's pack (plan 11, Task 3; spec §8.6): the course watcher, the setup's Language
 * step and Settings' native-language page all go through this. One install runs at a time; a call for the same client
 * and course already being installed joins it, and any other call waits its turn.
 */
export class PackSwitcher {
  readonly store: Store<PackSwitchState> = createStore<PackSwitchState>({ phase: 'idle' })
  private running: { readonly course: Course; readonly client: Client; readonly promise: Promise<ChangeL1Outcome> } | null = null
  /** The queue: each install chains onto this, whatever its own outcome, so the next one always gets its turn. */
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly deps: PackSwitchDeps) {}

  install(client: Client, account: AccountRecord | null, course: Course): Promise<ChangeL1Outcome> {
    const joining = this.running
    // A join also needs the same client: a signed-out demo and the account that replaces it are different clients,
    // so an install for one must never hand back the other's (still-running) promise.
    if (joining && sameCourse(joining.course, course) && joining.client === client) return joining.promise

    const after = this.queue
    const promise: Promise<ChangeL1Outcome> = after.then(() => this.run(client, account, course))
    this.running = { course, client, promise }
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

  private async run(client: Client, account: AccountRecord | null, course: Course): Promise<ChangeL1Outcome> {
    // Published before the manifest fetch too, so a retry never leaves a previous attempt's `failed` on screen.
    this.store.set({ phase: 'downloading', client, course, received: 0, total: 0 })
    try {
      const manifest = await this.deps.fetchManifest(account, course.target)
      const fetchPack = this.deps.fetcher((received, total) => this.store.set({ phase: 'downloading', client, course, received, total }))
      const outcome = await client.changeCourse(course, manifest, fetchPack)
      this.store.set(outcome.ok ? { phase: 'idle' } : { phase: 'failed', client, course })
      return outcome
    } catch (error) {
      // The client closed under us (an account switch mid-install, spec §8.6): that is not this course's failure to
      // report, and showing `failed` here would be stale as soon as the new client takes over. Idle, not failed.
      this.store.set(error instanceof ClientClosed ? { phase: 'idle' } : { phase: 'failed', client, course })
      return { ok: false, reason: 'unavailable' }
    }
  }
}
