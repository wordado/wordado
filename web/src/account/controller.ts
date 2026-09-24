import { accountIsEmpty, createStore, type Client, type Store, type SyncTransport } from '@wordado/client-data'
import type { BootState, SwitchOptions } from '../app/boot'
import type { Api } from './api'
import { DEMO_FILE, learnerFile, type AccountRecord, type AccountStorage, type PendingSignIn } from './storage'

/** What the shell tells the learner after an account change (spec §8.6: the demo's fate is stated plainly). */
export type AccountNotice = 'carried-over' | 'demo-discarded' | 'signed-in' | 'signed-out' | 'deleted' | 'other-account' | 'google-failed' | 'demo-left'

export interface AccountState {
  /** The server refused the session (a 401): syncing waits for the learner to sign in again. */
  readonly expired: boolean
  readonly notice: AccountNotice | null
}

/** What the controller needs of `Boot`. `switchTo` resolves false when it did not run (another tab has the database). */
export interface BootPort {
  readonly store: Store<BootState>
  switchTo(options?: SwitchOptions): Promise<boolean>
}

/** An account change asked for while `Boot` is not `'ready'` (spec §9.1). */
export class NotReady extends Error {
  constructor() {
    super('Wordado is still opening; try again')
    this.name = 'NotReady'
  }
}

/** Signing out needs the server, so the session cookie cannot outlive it; nothing on the device changed. */
export class SignOutOffline extends Error {
  constructor(cause: unknown) {
    super('Signing out needs a connection', { cause })
    this.name = 'SignOutOffline'
  }
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

  /** The open Client — the demo's or a learner's, whichever `Boot` currently holds. Throws while it is not `'ready'`: an account change must never guess at a database it cannot see. */
  private readyClient(): Client {
    const state = this.deps.boot.store.get()
    if (state.status !== 'ready') throw new NotReady()
    return state.client
  }

  private set(patch: Partial<AccountState>): void {
    this.store.set({ ...this.store.get(), ...patch })
  }

  /** The notice after a switch, only when the switch ran: another tab holding the database changed nothing here. */
  private announce(ran: boolean, patch: Partial<AccountState>): void {
    if (ran) this.set(patch)
  }

  /**
   * Attaches the demo to `userId` and records the carry-over before pushing
   * it, so a tab closed mid-push leaves a record that says the push is owed
   * (spec §8.6); then pushes, records whether it finished, and switches.
   */
  private async carryOver(client: Client, record: AccountRecord): Promise<void> {
    const { accounts, boot } = this.deps
    await client.attachUser(record.userId, this.deps.transport())
    accounts.save({ ...record, carryOver: true })
    await client.sync({ force: true })
    const carryOver = await client.hasUnsynced()
    accounts.save({ ...record, carryOver })
    this.announce(await boot.switchTo(carryOver ? {} : { deleteFiles: [DEMO_FILE] }), { expired: false, notice: 'carried-over' })
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
   * - A demo already attached to this same learner (a carry-over this device
   *   started but never finished, e.g. an interrupted push, with no account
   *   record left to remember it): push it again, unconditionally — it is
   *   already this learner's, so `accountIsEmpty` is never consulted.
   * - A demo already attached to a different learner (an owed carry-over this
   *   device never finished, e.g. after a forced sign-out): it is not this
   *   sign-in's to push; `Boot`'s sweep deletes it before the learner's file
   *   opens, as a device keeps one learner's data.
   * - From the demo into an account with no progress: attach the demo, push it
   *   from its own device, delete it once everything is up (spec §8.6).
   * - From the demo into an account with progress: delete the demo.
   *
   * Throws, changing nothing, when the account cannot be checked (offline),
   * or while `Boot` is not `'ready'` (spec §9.1): a sign-in landing mid-open
   * must never guess whether the database it cannot yet see holds progress.
   */
  async completeSignIn(country: string | null): Promise<SignInOutcome> {
    const { api, accounts, boot } = this.deps
    const me = await api.me()
    if (!me) throw new Error('The sign-in did not complete')
    const client = this.readyClient()

    const current = accounts.read()
    if (current && current.userId !== me.userId) {
      await api.signOut().catch(() => undefined)
      this.set({ notice: 'other-account' })
      return 'other-account'
    }

    if (country !== null && me.country !== country) await api.setCountry(country).catch(() => undefined)

    if (current) {
      this.set({ expired: false, notice: 'signed-in' })
      void client.sync({ force: true }).catch(() => undefined)
      return 'signed-in'
    }

    const record = { userId: me.userId, email: me.email }
    const demoUserId = client.snapshot.userId

    if (demoUserId !== null && demoUserId !== me.userId) {
      accounts.save(record)
      this.announce(await boot.switchTo(), { expired: false, notice: 'signed-in' })
      return 'signed-in'
    }

    if (demoUserId === me.userId) {
      await this.carryOver(client, record)
      return 'carried-over'
    }

    const hasProgress = await client.hasUnsynced()
    // Read-only, before any record names this learner: the pull carries no expected user.
    if (hasProgress && (await accountIsEmpty(this.deps.transport(), client.snapshot.deviceId))) {
      await this.carryOver(client, record)
      return 'carried-over'
    }
    accounts.save(record)
    const outcome: SignInOutcome = hasProgress ? 'demo-discarded' : 'signed-in'
    this.announce(await boot.switchTo({ deleteFiles: [DEMO_FILE] }), { expired: false, notice: outcome })
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
   * `force` deletes that file alongside the learner's own. Throws while
   * `Boot` is not `'ready'` (spec §9.1): a sign-out mid-switch must never
   * delete a file it has not confirmed is safe to lose. Signing out needs
   * the server: when it cannot be reached, throws `SignOutOffline` and
   * changes nothing, or the session cookie would stay valid on a device that
   * shows no account. Reminders stop only once the server has let go.
   */
  async signOut(options: { readonly force?: boolean } = {}): Promise<'signed-out' | 'unsynced'> {
    const { api, accounts, boot } = this.deps
    const account = accounts.read()
    if (!account) return 'signed-out'
    const client = this.readyClient()
    await client.sync({ force: true }).catch(() => undefined)
    if (!options.force) {
      if ((await client.hasUnsynced()) || account.carryOver) return 'unsynced'
    }
    try {
      await api.signOut()
    } catch (err) {
      throw new SignOutOffline(err)
    }
    // The session is gone, so the server's copy cannot be deleted; unsubscribing the browser ends it
    // (the push service answers "gone" to the next send, and the server forgets it).
    await this.deps.reminders?.stop({ server: false }).catch(() => undefined)
    accounts.clear()
    const deleteFiles = account.carryOver ? [learnerFile(account.userId), DEMO_FILE] : [learnerFile(account.userId)]
    this.announce(await boot.switchTo({ deleteFiles }), { expired: false, notice: 'signed-out' })
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
    this.announce(await boot.switchTo({ deleteFiles: [learnerFile(account.userId), DEMO_FILE] }), { expired: false, notice: 'deleted' })
  }

  /** Leaving the demo deletes it (spec §8.6); a fresh one opens. */
  async leaveDemo(): Promise<void> {
    if (this.deps.accounts.read() !== null) return
    this.announce(await this.deps.boot.switchTo({ deleteFiles: [DEMO_FILE] }), { notice: 'demo-left' })
  }
}

/** What the screens use of the controller; their tests pass a fake. */
export type AccountActions = Pick<AccountController, 'store' | 'completeSignIn' | 'resumeGoogle' | 'signOut' | 'deleteAccount' | 'leaveDemo' | 'dismissNotice'>
