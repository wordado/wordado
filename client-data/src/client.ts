import {
  canUse,
  isDayComplete,
  isSupportedL1,
  utcDay,
  type AudioClip,
  type Capability,
  type CefrLevel,
  type Corpus,
  type CorpusEntry,
  type Entitlement,
  type L1,
  type Mode,
  type PackManifest,
  type ReportRecord,
  type ReviewEvent,
  type ReviewState,
  type SessionPlan,
  type Settings,
  type WordFlag,
  type WordId,
} from '@wordado/core'
import { Database } from './database'
import { pendingDocumentWrites } from './documents'
import { addContentReport, addUnlocks, patchSettings, readAliases, readEntitlement, readFlags, readReports, readSettings, readToLearn, readUnlocks, setFlag, setToLearn, type ContentReportInput } from './documentTypes'
import type { SqlDriver } from './driver'
import type { ClientEnv } from './env'
import { appendAnswer, loadLearner, pendingDayComplete, provisionalXp, recordDayComplete, unpushedEvents, type AnswerInput, type Learner } from './learner'
import { ensureDevice, getUserId, setUserId } from './meta'
import { activateStagedPacks, activePackVersion, installedPacks, installPacks, loadActiveCorpus, type InstallReport, type PackFetcher } from './packs'
import { migrate } from './schema'
import { createStore, type Store } from './store'
import { availableModes, dayCompleteInput, entryOf, levelClips, newUnlocks, pathView, progressView, sessionPlan, today, toLearnWords, upcomingClips, type PathView, type ProgressView, type StudyContext } from './study'
import { INITIAL_SYNC_STATUS, readPulledXp, SyncEngine, type PulledXp, type SyncOutcome, type SyncStatus, type SyncTransport } from './sync'

export interface ClientOptions {
  readonly driver: SqlDriver
  readonly env: ClientEnv
  /**
   * The default L1 (spec §8.6): used only while no pack is installed and `settings.l1` is null, so it chooses at most
   * the first install. Once a pack is active its L1 is the Client's.
   */
  readonly l1: string
  /** Absent in demo mode and before sign-in: `sync` is then skipped. */
  readonly transport?: SyncTransport
}

/** The outcome of `Client.changeL1` (spec §8.6). */
export type ChangeL1Outcome = { readonly ok: true } | { readonly ok: false; readonly reason: 'unsupported' | 'unavailable' }

/** Lifetime and today's XP: the server's figures plus what it has not counted yet (spec §8.7). */
export interface ClientXp {
  readonly total: number
  readonly today: number
  readonly provisional: number
}

export interface ClientSnapshot {
  readonly deviceId: string
  readonly userId: string | null
  readonly corpus: Corpus | null
  /** Current review state: the server's snapshot with this device's newer events on top. */
  readonly states: ReadonlyMap<WordId, ReviewState>
  readonly settings: Settings
  readonly flags: ReadonlyMap<WordId, WordFlag>
  /**
   * Words the learner chose to learn that are not started yet, in the order chosen (spec §7.4): the daily session
   * serves them first. Empty before a pack is active.
   */
  readonly toLearn: readonly WordId[]
  readonly unlocked: ReadonlySet<string>
  readonly plan: SessionPlan | null
  readonly progress: ProgressView | null
  /** Unlocked units and the current unit; null before a pack is active (spec §7.2). */
  readonly path: PathView | null
  /** The active corpus version, cited by content reports (spec §8.10); null before a pack is active. */
  readonly packVersion: number | null
  readonly entitlement: Entitlement | null
  readonly xp: ClientXp
  readonly sync: SyncStatus
  /** The installed L1 (spec §8.6): see `Client.l1`. */
  readonly l1: string
}

export interface AnswerResult {
  readonly event: ReviewEvent
  /** True the one time an answer completes the day (spec §8.4). */
  readonly dayCompleted: boolean
  readonly unlocked: readonly string[]
}

/** Thrown by a Client that has been closed, or is closing, when asked for new work. */
export class ClientClosed extends Error {
  constructor() {
    super('The database is closed')
    this.name = 'ClientClosed'
  }
}

/**
 * The one object `web/` talks to (spec §4.1). Every mutation ends in
 * `refresh`, which recomputes an immutable snapshot and publishes it.
 */
export class Client {
  readonly store: Store<ClientSnapshot>
  private corpus: Corpus | null = null
  private packVersion: number | null = null
  private settings!: Settings
  private flags: Map<WordId, WordFlag> = new Map()
  private toLearn: Map<WordId, number> = new Map()
  private unlocked: Set<string> = new Set()
  private entitlement: Entitlement | null = null
  private userId: string | null = null
  private xp: PulledXp | null = null
  private engine: SyncEngine | null
  /** Answers and document writes still running: `close` waits for them (spec §9.1). */
  private readonly inFlight = new Set<Promise<unknown>>()
  private closing = false

  private constructor(
    private readonly db: Database,
    private readonly env: ClientEnv,
    private readonly defaultL1: string,
    private readonly learner: Learner,
    transport: SyncTransport | undefined,
  ) {
    this.engine = transport ? new SyncEngine({ db, env, learner, transport }) : null
    this.store = createStore<ClientSnapshot>(this.buildSnapshot())
    if (this.engine) this.engine.onStatus = () => this.refresh()
  }

  static async open(options: ClientOptions): Promise<Client> {
    const db = new Database(options.driver)
    await migrate(db)
    const deviceId = await ensureDevice(db, options.env)
    const learner = await loadLearner(db, deviceId, { aliases: await readAliases(db.driver) })
    const client = new Client(db, options.env, options.l1, learner, options.transport)
    client.corpus = await loadActiveCorpus(db)
    client.packVersion = await activePackVersion(db)
    client.userId = await getUserId(db)
    client.xp = await readPulledXp(db.driver)
    await client.reloadDocuments()
    client.refresh()
    return client
  }

  get snapshot(): ClientSnapshot {
    return this.store.get()
  }

  /**
   * The installed L1 (spec §8.6): the active pack's L1 whenever one is installed, whatever `settings.l1` says. A
   * setting that differs from it is a change still pending (offline, or the pack not yet fetched): only `changeL1`
   * moves this, so reports, pack checks and `startSession` keep serving the words the learner actually sees. Before
   * any pack is active it is `settings.l1 ?? options.l1`: the language the first install fetches.
   */
  get l1(): string {
    // `settings` is unset only for the constructor's first snapshot, which `open` replaces at once.
    return this.corpus?.l1 ?? (this.settings as Settings | undefined)?.l1 ?? this.defaultL1
  }

  private async reloadDocuments(): Promise<void> {
    this.settings = await readSettings(this.db.driver)
    this.flags = await readFlags(this.db.driver)
    this.toLearn = await readToLearn(this.db.driver)
    this.unlocked = await readUnlocks(this.db.driver)
    this.entitlement = await readEntitlement(this.db.driver)
    this.learner.aliases = await readAliases(this.db.driver)
  }

  /** The study inputs as of now; null before a pack is active. */
  private context(): StudyContext | null {
    if (!this.corpus) return null
    return {
      corpus: this.corpus,
      learner: this.learner,
      settings: this.settings,
      flags: this.flags,
      unlocked: this.unlocked,
      toLearn: this.toLearn,
      now: this.env.now(),
      tzOffsetMin: this.env.tzOffsetMin(),
    }
  }

  private buildSnapshot(): ClientSnapshot {
    const ctx = this.context()
    const plan = ctx ? sessionPlan(ctx) : null
    const xp = provisionalXp(this.learner)
    const provisionalToday = xp.byUtcDay.get(utcDay(this.env.now())) ?? 0
    const provisional = xp.total
    const pulledToday = this.xp && this.xp.utcDay === utcDay(this.env.now()) ? this.xp.today : 0
    const status = this.engine?.status ?? INITIAL_SYNC_STATUS
    return {
      deviceId: this.learner.deviceId,
      userId: this.userId,
      corpus: this.corpus,
      states: this.learner.states,
      settings: this.settings,
      flags: this.flags,
      toLearn: ctx ? toLearnWords(ctx) : [],
      unlocked: this.unlocked,
      plan,
      progress: ctx && plan ? progressView(ctx, plan) : null,
      path: ctx ? pathView(ctx) : null,
      packVersion: this.packVersion,
      entitlement: this.entitlement,
      xp: { total: (this.xp?.total ?? 0) + provisional, today: pulledToday + provisionalToday, provisional },
      // The outbox size is known from memory at all times, not only after a push.
      sync: { ...status, pendingEvents: this.learner.localEvents.filter((e) => !e.pushed).length },
      l1: this.l1,
    }
  }

  private refresh(): void {
    this.store.set(this.buildSnapshot())
  }

  /** Runs one piece of work that writes to the database, refusing it once the Client is closing. */
  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) throw new ClientClosed()
    const running = work()
    this.inFlight.add(running)
    try {
      return await running
    } finally {
      this.inFlight.delete(running)
    }
  }

  /** Resolves once no answer or document write is in flight. A sync is not waited for: it is safe to cut short. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled(this.inFlight)
  }

  /** Whether anything written here has not reached the server: answers, completed days, document patches. */
  async hasUnsynced(): Promise<boolean> {
    const driver = this.db.driver
    return (await unpushedEvents(driver)).length > 0 || (await pendingDayComplete(driver)).length > 0 || (await pendingDocumentWrites(driver)).length > 0
  }

  /** Fetches, verifies and stages newer packs for the learner's L1 (spec §5.1). Nothing changes until `startSession`. */
  installPacks(manifest: PackManifest, fetchPack: PackFetcher): Promise<InstallReport> {
    return installPacks(this.db, this.env, manifest, this.l1, fetchPack)
  }

  /** Loads what the active packs give the app: the corpus and its version (spec §5.1). */
  private async reloadCorpus(): Promise<void> {
    this.corpus = await loadActiveCorpus(this.db)
    this.packVersion = await activePackVersion(this.db)
  }

  /**
   * Swaps staged packs in and reloads the corpus. Call at the start of a
   * session, never mid-session. Also makes a completed day owed from a
   * previous answer (spec §8.4): unlike an unlock, a failed day-complete
   * write is not retried by the next answer once the day that completed it
   * is over, so this is the other place it is made.
   */
  async startSession(): Promise<string[]> {
    const activated = await activateStagedPacks(this.db, this.l1)
    if (activated.length > 0 || !this.corpus) await this.reloadCorpus()
    try {
      const ctx = this.context()
      if (ctx && isDayComplete(dayCompleteInput(ctx, sessionPlan(ctx)))) await recordDayComplete(this.db, this.learner, today(ctx), this.env.now())
    } catch {
      // Made again at the next answer or the next session start.
    }
    this.refresh()
    return activated
  }

  /**
   * Switches the installed L1 (spec §8.6): stages the new language's pack beside the current one, then swaps it in
   * and removes the other language's pack in one transaction. Review state is keyed by entry, so all progress
   * carries over. Nothing changes when the pack cannot be had (offline): the caller tries again later. Also installs
   * a learner's first pack (the setup's Language step): with no pack yet active, this always fetches and installs,
   * even when `l1` already equals `Client.l1` (which follows `settings.l1` before any pack exists).
   */
  changeL1(l1: L1, manifest: PackManifest, fetchPack: PackFetcher): Promise<ChangeL1Outcome> {
    return this.guarded(async () => {
      if (!isSupportedL1(l1)) return { ok: false, reason: 'unsupported' }
      // Compared with the active corpus, not `this.l1`: with no pack yet, `this.l1` follows the setting, and the first
      // install (the setup's Language step) must still fetch.
      if (this.corpus !== null && l1 === this.corpus.l1) return { ok: true }
      const report = await installPacks(this.db, this.env, manifest, l1, fetchPack)
      const installed = await installedPacks(this.db)
      const has = report.staged.length > 0 || installed.some((p) => p.pack_id === `corpus-${l1}`)
      if (!has) return { ok: false, reason: 'unavailable' }
      await activateStagedPacks(this.db, l1)
      // Reload what `open` loads from the active packs (corpus, pack version, session plan), as `startSession` does.
      // The new corpus's L1 is now `this.l1`.
      await this.reloadCorpus()
      this.refresh()
      return { ok: true }
    })
  }

  entry(wordId: WordId): CorpusEntry | null {
    return this.corpus ? entryOf(this.corpus, wordId) : null
  }

  availableModes(wordId: WordId, cachedClips: ReadonlySet<string>, online: boolean): Set<Mode> {
    const ctx = this.context()
    return ctx ? availableModes(ctx, wordId, cachedClips, online) : new Set<Mode>(['flashcard', 'multiple_choice'])
  }

  /** Clips worth fetching ahead (spec §9.3); empty before a pack is active. */
  upcomingClips(horizonDays?: number): AudioClip[] {
    const ctx = this.context()
    return ctx ? upcomingClips(ctx, sessionPlan(ctx), horizonDays) : []
  }

  /**
   * Records one answer, persists any new unit unlock, and records the completed
   * day when it first becomes complete. Once the event is stored this never
   * throws: a caller that saw an error would answer again and record the word
   * twice. A failed unlock is made at the next answer; a failed completed day
   * is made at the next answer or at the next `startSession` (spec §8.4),
   * whichever comes first.
   */
  answer(input: AnswerInput): Promise<AnswerResult> {
    return this.guarded(async () => {
      const event = await appendAnswer(this.db, this.env, this.learner, input)
      let dayCompleted = false
      let unlocked: string[] = []
      try {
        const before = this.context()
        if (before) {
          const owed = newUnlocks(before)
          if (owed.length > 0) {
            await this.db.transaction((tx) => addUnlocks(tx, owed))
            this.unlocked = new Set([...this.unlocked, ...owed])
            unlocked = owed
          }
          const ctx = this.context()!
          dayCompleted = isDayComplete(dayCompleteInput(ctx, sessionPlan(ctx))) && (await recordDayComplete(this.db, this.learner, today(ctx), this.env.now()))
        }
      } catch {
        // The answer itself is saved; what failed is owed and is made at the next answer.
      }
      this.refresh()
      return { event, dayCompleted, unlocked }
    })
  }

  updateSettings(patch: Record<string, unknown>): Promise<Settings> {
    return this.guarded(async () => {
      this.settings = await this.db.transaction((tx) => patchSettings(tx, patch))
      this.refresh()
      return this.settings
    })
  }

  setFlag(wordId: WordId, flag: WordFlag | null): Promise<void> {
    return this.guarded(async () => {
      await this.db.transaction((tx) => setFlag(tx, wordId, flag))
      this.flags = await readFlags(this.db.driver)
      this.refresh()
    })
  }

  /**
   * "Learn this word" (spec §7.4): marks a word the learner has not started, or takes the mark back. The daily
   * session then serves it as a new word, first in line and within the day's limit. Saved on the device at once
   * and synced like a flag; a mark on a word that is started is spent and ignored.
   */
  setToLearn(wordId: WordId, on: boolean): Promise<void> {
    return this.guarded(async () => {
      await this.db.transaction((tx) => setToLearn(tx, wordId, on ? this.env.now() : null))
      this.toLearn = await readToLearn(this.db.driver)
      this.refresh()
    })
  }

  /** Files a content report; it syncs like any document (spec §8.10). */
  report(input: ContentReportInput): Promise<string> {
    return this.guarded(() => this.db.transaction((tx) => addContentReport(tx, this.env, { ...input, l1: this.l1 })))
  }

  /** The learner's content reports, for telling them what has been fixed (spec §8.10, plan 8b). */
  reports(): Promise<ReportRecord[]> {
    return this.guarded(() => readReports(this.db.driver))
  }

  /** The one capability check (spec §8.8): the cached entitlement, honoured until its expiry. */
  canUse(capability: Capability): boolean {
    return canUse(capability, this.entitlement, this.env.now())
  }

  async sync(options: { force?: boolean } = {}): Promise<SyncOutcome> {
    if (!this.engine) return 'skipped'
    const outcome = await this.engine.sync(options)
    // A push can settle documents (a merge another device won) even when the pull then fails.
    if (outcome !== 'skipped') {
      await this.reloadDocuments()
      this.xp = await readPulledXp(this.db.driver)
    }
    this.refresh()
    return outcome
  }

  /**
   * Binds this database to an account (demo carry-over, spec §8.6). Every row
   * stays. With a transport, the Client syncs through it from now on: the
   * demo's answers then reach the account from the demo's own device.
   */
  attachUser(userId: string, transport?: SyncTransport): Promise<void> {
    return this.guarded(async () => {
      await this.db.transaction((tx) => setUserId(tx, userId))
      this.userId = userId
      if (transport && !this.engine) {
        this.engine = new SyncEngine({ db: this.db, env: this.env, learner: this.learner, transport })
        this.engine.onStatus = () => this.refresh()
      }
      this.refresh()
    })
  }

  /** Clips of one level's live words, for the whole-level download (spec §9.3); empty before a pack is active. */
  levelClips(level: CefrLevel): AudioClip[] {
    const ctx = this.context()
    return ctx ? levelClips(ctx, level) : []
  }

  /**
   * Refuses new work, waits for what is in flight, then closes the database.
   * Resolves only once the driver has let go of the file (spec §9.1: the tab
   * that takes over may open it the moment this resolves).
   */
  async close(): Promise<void> {
    this.closing = true
    await this.idle()
    await this.db.close()
  }
}
