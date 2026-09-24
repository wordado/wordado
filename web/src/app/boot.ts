import { Client, createStore, type ClientEnv, type InstallReport, type PackFetcher, type SqlDriver, type Store, type SyncTransport } from '@wordado/client-data'
import type { PackManifest } from '@wordado/core'
import { DEMO_FILE, learnerFile, type AccountRecord, type AccountStorage } from '../account/storage'
import type { Backend } from '../storage/protocol'

/** How long letting go waits for a last sync before closing anyway (spec §9.1). Tuning (§15). */
export const FLUSH_TIMEOUT_MS = 3_000

export type BootState =
  | { readonly status: 'starting' }
  /** Another tab owns the database (spec §9.1). */
  | { readonly status: 'elsewhere' }
  /** `resumed` is true once the shell appears after a take-over or a retry, rather than the first load, so `App` knows to move focus itself. */
  | { readonly status: 'ready'; readonly client: Client; readonly backend: Backend; readonly resumed: boolean; readonly account: AccountRecord | null }
  /**
   * 'lock' — the tab lock could not be taken; 'storage' — opening the
   * database or the Client on it failed; 'content' — no pack could be
   * installed or was already there.
   */
  | { readonly status: 'failed'; readonly message: string; readonly reason: 'lock' | 'storage' | 'content' }

/** What Boot needs of the tab lock (Task 5's TabLock). */
export interface LockPort {
  acquire(): Promise<boolean>
  takeOver(): Promise<void>
}

export interface BootDeps {
  readonly env: ClientEnv
  /** The learner's L1: which packs to install. Bulgarian in Phase 1a. */
  readonly l1: string
  /** Which account this device is signed in to, read at every open. Absent: always the demo. */
  readonly accounts?: AccountStorage
  /** Opens one database file: `demo`, or a learner's `user-<id>`. */
  openDriver(file: string): Promise<{ readonly driver: SqlDriver; readonly backend: Backend }>
  /** Deletes a closed file: the demo after a carry-over or when left, a learner's after sign-out. */
  deleteDatabase?(file: string): Promise<void>
  /** Every database file kept (`listDatabases`), so each open can sweep the files no account owns. Absent: no sweep. */
  listDatabases?(): Promise<readonly string[]>
  /** A signed-in learner's transport (spec §9.2). The demo has none. */
  transport?(): SyncTransport
  /** Starts syncing a learner's Client (`startSyncLoop`); returns how to stop it. */
  startSync?(client: Client, backend: Backend): () => void
  /** Tests shorten FLUSH_TIMEOUT_MS. */
  readonly flushTimeoutMs?: number
  fetchManifest(): Promise<PackManifest>
  readonly fetchPack: PackFetcher
  /** Quick work before the app shows, such as reading the audio cache's index. Its failure never fails the boot. */
  prepare?(client: Client): Promise<void>
  /** Background work once ready, such as prefetching audio. Its failure never fails the boot. */
  onReady?(client: Client): Promise<void>
  /** The launch install's report: a pack may need a newer app (spec §9.3). */
  onInstallReport?(report: InstallReport): void
}

export interface SwitchOptions {
  /** Files to delete, in order, once the open one is closed and before the next opens. */
  readonly deleteFiles?: readonly string[]
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
  private account: AccountRecord | null = null
  private stopSync: (() => void) | null = null
  /** The close in progress, if any; `closeClient` chains on it. */
  private closing: Promise<void> = Promise.resolve()
  /** Bumped when the database is given up, so an open still in flight does not become ready. */
  private generation = 0
  /** Whether this tab currently holds the lock; cleared on `release()` and by a failed acquire or take-over. */
  private lockHeld = false
  /** Which lock step `retry()` repeats first when the lock has been lost: `start()`'s acquire, or `takeOver()`. */
  private lastLockAttempt: 'acquire' | 'takeOver' = 'acquire'
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
    this.lastLockAttempt = 'acquire'
    let held: boolean
    try {
      held = await this.lock.acquire()
    } catch (err) {
      this.store.set({ status: 'failed', message: messageOf(err), reason: 'lock' })
      return
    }
    if (!held) {
      this.store.set({ status: 'elsewhere' })
      return
    }
    this.lockHeld = true
    await this.open(false)
  }

  /** The learner chose to use Wordado in this tab (spec §9.1). */
  async takeOver(): Promise<void> {
    this.store.set({ status: 'starting' })
    this.lastLockAttempt = 'takeOver'
    try {
      await this.lock.takeOver()
    } catch (err) {
      this.store.set({ status: 'failed', message: messageOf(err), reason: 'lock' })
      return
    }
    this.lockHeld = true
    await this.open(true)
  }

  /**
   * After a failed start: if the lock is still held (a storage or content
   * failure), only the opening is tried again; if the lock itself failed
   * (`acquire` or `takeOver`), that same step is repeated first.
   */
  async retry(): Promise<void> {
    this.store.set({ status: 'starting' })
    if (!this.lockHeld) {
      try {
        if (this.lastLockAttempt === 'takeOver') {
          await this.lock.takeOver()
        } else {
          const held = await this.lock.acquire()
          if (!held) {
            this.store.set({ status: 'elsewhere' })
            return
          }
        }
      } catch (err) {
        this.store.set({ status: 'failed', message: messageOf(err), reason: 'lock' })
        return
      }
      this.lockHeld = true
    }
    await this.open(true)
  }

  /**
   * Called by the lock when another tab takes over (spec §9.1): say so, let
   * any answer being written finish, flush (for at most FLUSH_TIMEOUT_MS),
   * then close. Resolves once the file is let go, and only then does the
   * lock pass on.
   */
  async release(): Promise<void> {
    this.generation += 1
    this.lockHeld = false
    if (this.opening) await this.opening.catch(() => undefined)
    this.store.set({ status: 'elsewhere' })
    await this.closeClient(true)
  }

  /**
   * The account changed — sign-in, sign-out, deletion, leaving the demo
   * (spec §8.6): close what is open, delete `deleteFile` once nothing holds
   * it, and open the file of the account now recorded. Keeps the tab lock.
   * Does not flush: the caller has synced what should be synced, and after a
   * deletion there is no account to flush to.
   *
   * Captures its own generation: two overlapping `switchTo()` calls (or a
   * `switchTo()` racing a `release()`) must not both reach `open()`, or the
   * learner's file opens twice, one `Client` leaks, and its sync loop is
   * never stopped. Only the call that is still current once the close (and
   * any delete) has finished goes on to open; the superseded one simply
   * stops — `open()`'s own generation checks are the second line of defence
   * once an open is actually under way.
   *
   * Resolves true when it ran: the file was closed and `deleteFiles` deleted.
   * False when this tab no longer holds the lock, before or during the
   * switch: another tab has the database, and the caller must not announce
   * a change that did not happen here.
   */
  async switchTo(options: SwitchOptions = {}): Promise<boolean> {
    if (!this.lockHeld) return false
    const generation = ++this.generation
    if (this.opening) await this.opening.catch(() => undefined)
    this.store.set({ status: 'starting' })
    await this.closeClient(false, options.deleteFiles)
    if (generation !== this.generation) return this.lockHeld
    await this.open(true)
    return true
  }

  /**
   * Closes the open Client, one close (and any delete) at a time: a release
   * that lands while a switch is still closing — or deleting — waits for
   * that step, so the lock never passes on while this tab still holds or is
   * still erasing a file.
   */
  private closeClient(flush: boolean, deleteFiles?: readonly string[]): Promise<void> {
    const run = this.closing.then(() => this.closeNow(flush, deleteFiles))
    this.closing = run.catch(() => undefined)
    return run
  }

  /**
   * Stops syncing, waits for in-flight answers, optionally flushes, closes
   * the Client, and only then — inside this same serialised step — deletes
   * `deleteFiles`, in order, if given, so a hand-over landing mid-switch
   * waits for the deletes too (spec §8.6, §9.1).
   */
  private async closeNow(flush: boolean, deleteFiles?: readonly string[]): Promise<void> {
    this.stopSync?.()
    this.stopSync = null
    const client = this.client
    this.client = null
    if (client) {
      await client.idle()
      if (flush) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.deps.flushTimeoutMs ?? FLUSH_TIMEOUT_MS)
        })
        // Force past any backoff: letting go must flush even mid-retry (spec §9.1).
        await Promise.race([client.sync({ force: true }).catch(() => undefined), timeout])
        clearTimeout(timer)
      }
      // A sync cut short by the timeout fails on the closed database; its answers are pushed again next time, and the server drops duplicates.
      await client.close().catch(() => undefined)
    }
    if (deleteFiles) for (const file of deleteFiles) await this.deps.deleteDatabase?.(file).catch(() => undefined)
  }

  private async open(resumed: boolean): Promise<void> {
    const generation = this.generation
    if (!this.client) {
      try {
        const acquiring = this.acquireClient(generation)
        this.opening = acquiring
        try {
          await acquiring
        } finally {
          if (this.opening === acquiring) this.opening = null
        }
      } catch (err) {
        if (generation === this.generation) this.store.set({ status: 'failed', message: messageOf(err), reason: 'storage' })
        return
      }
      if (generation !== this.generation) return
    }
    try {
      const client = this.client!
      let installFailure: unknown = null
      try {
        const report = await client.installPacks(await this.deps.fetchManifest(), this.deps.fetchPack)
        this.deps.onInstallReport?.(report)
      } catch (err) {
        installFailure = err
      }
      await client.startSession()
      if (generation !== this.generation) return
      if (!client.snapshot.corpus) throw installFailure ?? new Error('No words are installed')
      await this.deps.prepare?.(client).catch(() => undefined)
      if (generation !== this.generation) return
      if (this.account && this.deps.startSync) this.stopSync = this.deps.startSync(client, this.backend)
      this.store.set({ status: 'ready', client, backend: this.backend, resumed, account: this.account })
      void this.deps.onReady?.(client).catch(() => undefined)
    } catch (err) {
      if (generation === this.generation) this.store.set({ status: 'failed', message: messageOf(err), reason: 'content' })
    }
  }

  /**
   * Opens the recorded account's file (or the demo's), after sweeping the
   * files no account owns and finishing any owed carry-over, then the Client
   * on it. Sets `this.client` only when the
   * lock is still held by the time each step finishes; otherwise closes
   * whatever was opened and leaves `this.client` untouched, so `release()`
   * need not know about either. Rethrows a `Client.open` failure after
   * closing the driver it was given.
   */
  private async acquireClient(generation: number): Promise<void> {
    const account = await this.sweep(this.deps.accounts?.read() ?? null)
    if (account?.carryOver) await this.carryOverDemo(account)
    if (generation !== this.generation) return
    const { driver, backend } = await this.deps.openDriver(account ? learnerFile(account.userId) : DEMO_FILE)
    if (generation !== this.generation) {
      await driver.close().catch(() => undefined)
      return
    }
    this.backend = backend
    let client: Client
    try {
      const transport = account ? this.deps.transport?.() : undefined
      client = await Client.open({ driver, env: this.deps.env, l1: this.deps.l1, ...(transport ? { transport } : {}) })
    } catch (err) {
      await driver.close().catch(() => undefined)
      throw err
    }
    if (generation !== this.generation) {
      await client.close()
      return
    }
    this.client = client
    this.account = account
  }

  /**
   * A device keeps the demo and at most one learner's file (spec §8.6), yet a
   * failed delete, a deleted account's file another tab still held, or a
   * demo left after a discard can outlive their account. Before each open:
   * every learner's file but the recorded one goes, and, under a record, a
   * demo not attached to that learner. A demo attached to them is a
   * carry-over, flagged here if the record lost the flag, so
   * `carryOverDemo` finishes it. Returns the record as it now stands. Never
   * fails the boot: what cannot be listed, read or deleted is left for the
   * next open.
   */
  private async sweep(account: AccountRecord | null): Promise<AccountRecord | null> {
    const { listDatabases, deleteDatabase } = this.deps
    if (!listDatabases || !deleteDatabase) return account
    let files: readonly string[]
    try {
      files = await listDatabases()
    } catch {
      return account
    }
    const kept = account ? learnerFile(account.userId) : null
    for (const file of files) if (file.startsWith('user-') && file !== kept) await deleteDatabase(file).catch(() => undefined)
    if (!account || account.carryOver || !files.includes(DEMO_FILE)) return account
    const owner = await this.demoOwner()
    if (owner === undefined) return account
    if (owner === account.userId) {
      const flagged = { ...account, carryOver: true }
      this.deps.accounts?.save(flagged)
      return flagged
    }
    await deleteDatabase(DEMO_FILE).catch(() => undefined)
    return account
  }

  /** Whom the demo on disk is attached to (null: nobody); undefined when it cannot be read. */
  private async demoOwner(): Promise<string | null | undefined> {
    let opened: { readonly driver: SqlDriver; readonly backend: Backend }
    try {
      opened = await this.deps.openDriver(DEMO_FILE)
    } catch {
      return undefined
    }
    let demo: Client | null = null
    try {
      demo = await Client.open({ driver: opened.driver, env: this.deps.env, l1: this.deps.l1 })
      return demo.snapshot.userId
    } catch {
      return undefined
    } finally {
      if (demo) await demo.close().catch(() => undefined)
      else await opened.driver.close().catch(() => undefined)
    }
  }

  /**
   * Finishes a carry-over the last session could not (spec §8.6): a demo
   * attached to this account is pushed from its own device and, once nothing
   * is left unsynced, deleted. A demo attached to nobody (or someone else) is
   * not this account's: it is deleted and the flag cleared. The push is
   * bounded by the flush timeout, so a hung server never holds the launch or
   * a take-over. Never fails the boot: the flag stays, and the next open
   * tries again.
   */
  private async carryOverDemo(account: AccountRecord): Promise<void> {
    const transport = this.deps.transport?.()
    if (!transport) return
    let opened: { readonly driver: SqlDriver; readonly backend: Backend }
    try {
      opened = await this.deps.openDriver(DEMO_FILE)
    } catch {
      return
    }
    let demo: Client | null = null
    let finished = opened.backend === 'memory'
    let pushed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (!finished) {
        demo = await Client.open({ driver: opened.driver, env: this.deps.env, l1: this.deps.l1, transport })
        if (demo.snapshot.userId !== account.userId) finished = true
        else {
          const timeout = new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), this.deps.flushTimeoutMs ?? FLUSH_TIMEOUT_MS)
          })
          // A sync cut short fails on the closed database; the flag stays and the next open pushes again.
          const outcome = await Promise.race([demo.sync({ force: true }), timeout])
          pushed = outcome !== 'timeout' && !(await demo.hasUnsynced())
        }
      }
    } catch {
      // Offline, or the demo cannot be read: the next open tries again.
    } finally {
      clearTimeout(timer)
      if (demo) await demo.close().catch(() => undefined)
      else await opened.driver.close().catch(() => undefined)
    }
    if (pushed || (finished && opened.backend !== 'memory')) await this.deps.deleteDatabase?.(DEMO_FILE).catch(() => undefined)
    if (pushed || finished) this.deps.accounts?.save({ ...account, carryOver: false })
  }
}
