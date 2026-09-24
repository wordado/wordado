import { Client, createStore, type ClientEnv, type PackFetcher, type SqlDriver, type Store } from '@wordado/client-data'
import type { PackManifest } from '@wordado/core'
import type { Backend } from '../storage/protocol'

export type BootState =
  | { readonly status: 'starting' }
  /** Another tab owns the database (spec §9.1). */
  | { readonly status: 'elsewhere' }
  /** `resumed` is true once the shell appears after a take-over or a retry, rather than the first load, so `App` knows to move focus itself. */
  | { readonly status: 'ready'; readonly client: Client; readonly backend: Backend; readonly resumed: boolean }
  | { readonly status: 'failed'; readonly message: string }

/** What Boot needs of the tab lock (Task 5's TabLock). */
export interface LockPort {
  acquire(): Promise<boolean>
  takeOver(): Promise<void>
}

export interface BootDeps {
  readonly env: ClientEnv
  /** The learner's L1: which packs to install. Bulgarian in Phase 1a. */
  readonly l1: string
  openDriver(): Promise<{ readonly driver: SqlDriver; readonly backend: Backend }>
  fetchManifest(): Promise<PackManifest>
  readonly fetchPack: PackFetcher
  /** Quick work before the app shows, such as reading the audio cache's index. Its failure never fails the boot. */
  prepare?(client: Client): Promise<void>
  /** Background work once ready, such as prefetching audio. Its failure never fails the boot. */
  onReady?(client: Client): Promise<void>
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Starts the app (spec §9.1, §5.1): take the tab lock, open the database,
 * open the Client, install newer packs (a failure is fine if a pack is
 * already installed: the learner may be offline), start the session.
 */
export class Boot {
  readonly store: Store<BootState> = createStore<BootState>({ status: 'starting' })
  private readonly lock: LockPort
  private client: Client | null = null
  private backend: Backend = 'memory'
  /** Bumped when the database is given up, so an open still in flight does not become ready. */
  private generation = 0
  /**
   * Set only while opening the driver and the Client, i.e. before `this.client`
   * exists to be closed the ordinary way. `release()` awaits it so the lock is
   * handed over only once this tab has let go of whatever it opened.
   */
  private opening: Promise<void> | null = null

  constructor(
    private readonly deps: BootDeps,
    makeLock: (release: () => Promise<void>) => LockPort,
  ) {
    this.lock = makeLock(() => this.release())
  }

  async start(): Promise<void> {
    this.store.set({ status: 'starting' })
    let held: boolean
    try {
      held = await this.lock.acquire()
    } catch (err) {
      this.store.set({ status: 'failed', message: messageOf(err) })
      return
    }
    if (!held) {
      this.store.set({ status: 'elsewhere' })
      return
    }
    await this.open(false)
  }

  /** The learner chose to use Wordado in this tab (spec §9.1). */
  async takeOver(): Promise<void> {
    this.store.set({ status: 'starting' })
    try {
      await this.lock.takeOver()
    } catch (err) {
      this.store.set({ status: 'failed', message: messageOf(err) })
      return
    }
    await this.open(true)
  }

  /** After a failed start: the lock is still held, so only the opening is tried again. */
  async retry(): Promise<void> {
    this.store.set({ status: 'starting' })
    await this.open(true)
  }

  /** Called by the lock when another tab takes over: close, and say so. 6b flushes the outbox first. */
  async release(): Promise<void> {
    this.generation += 1
    if (this.opening) await this.opening.catch(() => undefined)
    const client = this.client
    this.client = null
    this.store.set({ status: 'elsewhere' })
    await client?.close()
  }

  private async open(resumed: boolean): Promise<void> {
    const generation = this.generation
    try {
      if (!this.client) {
        const acquiring = this.acquireClient(generation)
        this.opening = acquiring
        try {
          await acquiring
        } finally {
          if (this.opening === acquiring) this.opening = null
        }
        if (generation !== this.generation) return
      }
      const client = this.client!
      let installFailure: unknown = null
      try {
        await client.installPacks(await this.deps.fetchManifest(), this.deps.fetchPack)
      } catch (err) {
        installFailure = err
      }
      await client.startSession()
      if (generation !== this.generation) return
      if (!client.snapshot.corpus) throw installFailure ?? new Error('No words are installed')
      await this.deps.prepare?.(client).catch(() => undefined)
      if (generation !== this.generation) return
      this.store.set({ status: 'ready', client, backend: this.backend, resumed })
      void this.deps.onReady?.(client).catch(() => undefined)
    } catch (err) {
      if (generation === this.generation) this.store.set({ status: 'failed', message: messageOf(err) })
    }
  }

  /**
   * Opens the driver, then the Client on it. Sets `this.client` only when the
   * lock is still held by the time each step finishes; otherwise closes
   * whatever was opened (the bare driver, or the Client) and leaves
   * `this.client` untouched, so `release()` need not know about either.
   * Rethrows a `Client.open` failure after closing the driver it was given.
   */
  private async acquireClient(generation: number): Promise<void> {
    const { driver, backend } = await this.deps.openDriver()
    if (generation !== this.generation) {
      await driver.close().catch(() => undefined)
      return
    }
    this.backend = backend
    let client: Client
    try {
      client = await Client.open({ driver, env: this.deps.env, l1: this.deps.l1 })
    } catch (err) {
      await driver.close().catch(() => undefined)
      throw err
    }
    if (generation !== this.generation) {
      await client.close()
      return
    }
    this.client = client
  }
}
