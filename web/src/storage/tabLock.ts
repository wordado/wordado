import { createStore, type Store } from '@wordado/client-data'

/** idle: asking; owner: this tab holds the database; elsewhere: another tab does (spec §9.1). */
export type LockState = 'idle' | 'owner' | 'elsewhere'

/** How long a take-over waits for the owner before stealing the lock. Tuning (§15). */
export const TAKE_OVER_WAIT_MS = 5_000

export const DEFAULT_LOCK_NAME = 'wordado-db'

const TAKE_OVER = 'take-over'

export interface TabLockOptions {
  readonly name?: string
  /**
   * Gives the database up: flush what can be flushed, then close it. Called
   * before the lock is released when another tab asks, and after the fact
   * when the lock is stolen. Errors are swallowed: the tab lets go regardless.
   */
  release(): Promise<void>
  readonly waitMs?: number
  readonly locks?: LockManager
  readonly channel?: BroadcastChannel
}

/** Single-tab ownership of the database: a Web Lock, and a BroadcastChannel to ask for it (spec §9.1). */
export class TabLock {
  readonly store: Store<LockState> = createStore<LockState>('idle')
  private readonly name: string
  private readonly waitMs: number
  private readonly locks: LockManager
  private readonly channel: BroadcastChannel
  private letGo: (() => void) | null = null
  /** Settles once the lock this tab holds has been released. */
  private holding: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: TabLockOptions) {
    this.name = options.name ?? DEFAULT_LOCK_NAME
    this.waitMs = options.waitMs ?? TAKE_OVER_WAIT_MS
    this.locks = options.locks ?? navigator.locks
    this.channel = options.channel ?? new BroadcastChannel(this.name)
    this.channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === TAKE_OVER && this.state === 'owner') void this.handOver()
    }
  }

  get state(): LockState {
    return this.store.get()
  }

  private async giveUp(): Promise<void> {
    try {
      await this.options.release()
    } catch {
      // Nothing more can be done for the database; letting go matters more.
    }
  }

  /** Another tab asked: release, then let go of the lock. */
  private async handOver(): Promise<void> {
    await this.giveUp()
    this.store.set('elsewhere')
    const letGo = this.letGo
    this.letGo = null
    letGo?.()
  }

  /** The lock was stolen: the other tab already has it. Close, and say so. */
  private async stolen(): Promise<void> {
    this.letGo = null
    if (this.state !== 'owner') return
    this.store.set('elsewhere')
    await this.giveUp()
  }

  /** Resolves true once held, false when `ifAvailable` found it taken; rejects if the request fails. */
  private request(options: LockOptions): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      let held = false
      const request = this.locks
        .request(this.name, options, async (lock) => {
          if (!lock) {
            resolve(false)
            return
          }
          held = true
          this.store.set('owner')
          resolve(true)
          await new Promise<void>((release) => {
            this.letGo = release
          })
        })
        .catch((err: unknown) => {
          if (held) void this.stolen()
          else reject(err)
        })
      this.holding = request
    })
  }

  /** Takes the lock if no other tab holds it. */
  async acquire(): Promise<boolean> {
    this.store.set('idle')
    const held = await this.request({ ifAvailable: true })
    if (!held) this.store.set('elsewhere')
    return held
  }

  /** Asks the owner to let go and waits for the lock; steals it if the owner does not answer in time. */
  async takeOver(): Promise<void> {
    if (this.state === 'owner') return
    this.store.set('idle')
    this.channel.postMessage(TAKE_OVER)
    try {
      await this.request({ signal: AbortSignal.timeout(this.waitMs) })
    } catch {
      await this.request({ steal: true })
    }
  }

  /**
   * Stops listening and lets go of the lock, resolving once the browser has
   * released it. `keepLock` keeps holding it (tests use it to play a frozen tab).
   */
  async dispose(options: { readonly keepLock?: boolean } = {}): Promise<void> {
    this.channel.close()
    if (options.keepLock) return
    const letGo = this.letGo
    this.letGo = null
    letGo?.()
    await this.holding
  }
}
