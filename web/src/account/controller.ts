import { accountIsEmpty, createStore, type Client, type Store, type SyncTransport } from '@wordado/client-data'
import type { BootState, SwitchOptions } from '../app/boot'
import type { Api } from './api'
import { DEMO_FILE, learnerFile, type AccountStorage, type PendingSignIn } from './storage'

/** What the shell tells the learner after an account change (spec §8.6: the demo's fate is stated plainly). */
export type AccountNotice = 'carried-over' | 'demo-discarded' | 'signed-in' | 'signed-out' | 'deleted' | 'other-account' | 'google-failed' | 'demo-left'

export interface AccountState {
  /** The server refused the session (a 401): syncing waits for the learner to sign in again. */
  readonly expired: boolean
  readonly notice: AccountNotice | null
}

/** What the controller needs of `Boot`. */
export interface BootPort {
  readonly store: Store<BootState>
  switchTo(options?: SwitchOptions): Promise<void>
}

/** Reminders on this device (Task 12): stopped when the account goes, on the server too unless it is already gone. */
export interface ReminderPort {
  stop(options: { readonly server: boolean }): Promise<void>
}

export interface PendingStore {
  read(): PendingSignIn | null
  clear(): void
}

export interface AccountDeps {
  readonly api: Api
  readonly boot: BootPort
  readonly accounts: AccountStorage
  readonly pending: PendingStore
  transport(): SyncTransport
  readonly reminders?: ReminderPort
}

export type SignInOutcome = 'signed-in' | 'carried-over' | 'demo-discarded' | 'other-account'

/**
 * Accounts on this device (spec §8.6, §11): what a sign-in does to the demo,
 * what signing out and deleting leave behind. Every rule about data is
 * `client-data`'s (`accountIsEmpty`, `attachUser`, `hasUnsynced`); this
 * class sequences them and switches files through `Boot`.
 */
export class AccountController {
  readonly store: Store<AccountState> = createStore<AccountState>({ expired: false, notice: null })

  constructor(private readonly deps: AccountDeps) {}

  private client(): Client | null {
    const state = this.deps.boot.store.get()
    return state.status === 'ready' ? state.client : null
  }

  private set(patch: Partial<AccountState>): void {
    this.store.set({ ...this.store.get(), ...patch })
  }

  /** From the transport: the server answered 401. Only a signed-in learner can have an expired sign-in. */
  sessionExpired(): void {
    if (this.deps.accounts.read() !== null && !this.store.get().expired) this.set({ expired: true })
  }

  dismissNotice(): void {
    this.set({ notice: null })
  }

  /**
   * Runs once the server holds a session for this browser: after a verified
   * code, or back from Google. `country` is the age gate's (spec §11), the
   * only thing kept of it.
   *
   * - Signed in as someone else: refuse, and sign the new session out — this
   *   device's answers belong to its learner, and are neither pushed nor
   *   deleted. Checked first, so a refused session's country is never saved.
   * - Already signed in as the same learner (an expired sign-in): resume syncing.
   * - A demo already attached to a different learner (an owed carry-over this
   *   device never finished, e.g. after a forced sign-out): it is not this
   *   sign-in's to push or discard, so it is left exactly as it is.
   * - From the demo into an account with no progress: attach the demo, push it
   *   from its own device, delete it once everything is up (spec §8.6).
   * - From the demo into an account with progress: delete the demo.
   *
   * Throws, changing nothing, when the account cannot be checked (offline).
   */
  async completeSignIn(country: string | null): Promise<SignInOutcome> {
    const { api, accounts, boot } = this.deps
    const me = await api.me()
    if (!me) throw new Error('The sign-in did not complete')

    const current = accounts.read()
    if (current && current.userId !== me.userId) {
      await api.signOut().catch(() => undefined)
      this.set({ notice: 'other-account' })
      return 'other-account'
    }

    if (country !== null && me.country !== country) await api.setCountry(country).catch(() => undefined)

    if (current) {
      this.set({ expired: false, notice: 'signed-in' })
      void this.client()?.sync({ force: true }).catch(() => undefined)
      return 'signed-in'
    }

    const demo = this.client()
    const record = { userId: me.userId, email: me.email }
    const demoUserId = demo?.snapshot.userId ?? null
    if (demo !== null && demoUserId !== null && demoUserId !== me.userId) {
      accounts.save(record)
      await boot.switchTo()
      this.set({ expired: false, notice: 'signed-in' })
      return 'signed-in'
    }

    const hasProgress = demo !== null && (await demo.hasUnsynced())
    if (demo && hasProgress) {
      const transport = this.deps.transport()
      if (await accountIsEmpty(transport, demo.snapshot.deviceId)) {
        await demo.attachUser(me.userId, transport)
        await demo.sync({ force: true })
        const carryOver = await demo.hasUnsynced()
        accounts.save({ ...record, carryOver })
        await boot.switchTo(carryOver ? {} : { deleteFiles: [DEMO_FILE] })
        this.set({ expired: false, notice: 'carried-over' })
        return 'carried-over'
      }
    }
    accounts.save(record)
    await boot.switchTo({ deleteFiles: [DEMO_FILE] })
    const outcome: SignInOutcome = hasProgress ? 'demo-discarded' : 'signed-in'
    this.set({ expired: false, notice: outcome })
    return outcome
  }

  /**
   * Back from Google (spec §8.6). The age gate's country crossed the
   * redirect in this tab's session storage; without it the gate was not
   * passed here, so the session is signed out rather than used.
   */
  async resumeGoogle(result: 'ok' | 'error'): Promise<SignInOutcome | null> {
    const pending = this.deps.pending.read()
    this.deps.pending.clear()
    if (result === 'error' || pending === null) {
      if (result === 'ok') await this.deps.api.signOut().catch(() => undefined)
      this.set({ notice: 'google-failed' })
      return null
    }
    try {
      return await this.completeSignIn(pending.country)
    } catch (err) {
      this.set({ notice: 'google-failed' })
      throw err
    }
  }

  /**
   * Flushes, then signs out and deletes this learner's file (a shared browser
   * keeps nothing). Answers that could not be flushed are lost by signing
   * out, so without `force` it returns 'unsynced' and changes nothing. A
   * carry-over this device still owes (its push never got through) counts
   * as unsynced too — the demo holds this learner's only copy of it, so
   * `force` deletes that file alongside the learner's own.
   */
  async signOut(options: { readonly force?: boolean } = {}): Promise<'signed-out' | 'unsynced'> {
    const { api, accounts, boot } = this.deps
    const account = accounts.read()
    if (!account) return 'signed-out'
    const client = this.client()
    if (client) await client.sync({ force: true }).catch(() => undefined)
    if (!options.force) {
      const clientUnsynced = client !== null && (await client.hasUnsynced())
      if (clientUnsynced || account.carryOver) return 'unsynced'
    }
    await this.deps.reminders?.stop({ server: true }).catch(() => undefined)
    await api.signOut().catch(() => undefined)
    accounts.clear()
    const deleteFiles = account.carryOver ? [learnerFile(account.userId), DEMO_FILE] : [learnerFile(account.userId)]
    await boot.switchTo({ deleteFiles })
    this.set({ expired: false, notice: 'signed-out' })
    return 'signed-out'
  }

  /**
   * Self-service erasure (spec §11): the server first — if that fails,
   * nothing here changes — then this device. Both files go, whether or not a
   * carry-over was still owed: no trace of the account survives on the
   * device it deleted itself from. A fresh demo opens either way.
   */
  async deleteAccount(): Promise<void> {
    const { api, accounts, boot } = this.deps
    const account = accounts.read()
    if (!account) return
    await api.deleteAccount()
    await this.deps.reminders?.stop({ server: false }).catch(() => undefined)
    accounts.clear()
    await boot.switchTo({ deleteFiles: [learnerFile(account.userId), DEMO_FILE] })
    this.set({ expired: false, notice: 'deleted' })
  }

  /** Leaving the demo deletes it (spec §8.6); a fresh one opens. */
  async leaveDemo(): Promise<void> {
    if (this.deps.accounts.read() !== null) return
    await this.deps.boot.switchTo({ deleteFiles: [DEMO_FILE] })
    this.set({ notice: 'demo-left' })
  }
}

/** What the screens use of the controller; their tests pass a fake. */
export type AccountActions = Pick<AccountController, 'store' | 'completeSignIn' | 'resumeGoogle' | 'signOut' | 'deleteAccount' | 'leaveDemo' | 'dismissNotice'>
