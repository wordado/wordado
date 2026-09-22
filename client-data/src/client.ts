import {
  canUse,
  isDayComplete,
  utcDay,
  type Capability,
  type Corpus,
  type CorpusEntry,
  type Entitlement,
  type Mode,
  type PackManifest,
  type ReviewEvent,
  type ReviewState,
  type SessionPlan,
  type Settings,
  type WordFlag,
  type WordId,
} from '@wordado/core'
import { Database } from './database'
import { addContentReport, addUnlocks, patchSettings, readAliases, readEntitlement, readFlags, readSettings, readUnlocks, setFlag, type ContentReportInput } from './documentTypes'
import type { SqlDriver } from './driver'
import type { ClientEnv } from './env'
import { appendAnswer, loadLearner, provisionalXp, recordDayComplete, type AnswerInput, type Learner } from './learner'
import { ensureDevice, getUserId, setUserId } from './meta'
import { activateStagedPacks, installPacks, loadActiveCorpus, type InstallReport, type PackFetcher } from './packs'
import { migrate } from './schema'
import { createStore, type Store } from './store'
import { availableModes, dayCompleteInput, entryOf, newUnlocks, progressView, sessionPlan, today, type ProgressView, type StudyContext } from './study'
import { INITIAL_SYNC_STATUS, readPulledXp, SyncEngine, type PulledXp, type SyncOutcome, type SyncStatus, type SyncTransport } from './sync'

export interface ClientOptions {
  readonly driver: SqlDriver
  readonly env: ClientEnv
  /** The learner's L1: which packs to install. */
  readonly l1: string
  /** Absent in demo mode and before sign-in: `sync` is then skipped. */
  readonly transport?: SyncTransport
}

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
  readonly unlocked: ReadonlySet<string>
  readonly plan: SessionPlan | null
  readonly progress: ProgressView | null
  readonly entitlement: Entitlement | null
  readonly xp: ClientXp
  readonly sync: SyncStatus
}

export interface AnswerResult {
  readonly event: ReviewEvent
  /** True the one time an answer completes the day (spec §8.4). */
  readonly dayCompleted: boolean
  readonly unlocked: readonly string[]
}

/**
 * The one object `web/` talks to (spec §4.1). Every mutation ends in
 * `refresh`, which recomputes an immutable snapshot and publishes it.
 */
export class Client {
  readonly store: Store<ClientSnapshot>
  private corpus: Corpus | null = null
  private settings!: Settings
  private flags: Map<WordId, WordFlag> = new Map()
  private unlocked: Set<string> = new Set()
  private entitlement: Entitlement | null = null
  private userId: string | null = null
  private xp: PulledXp | null = null
  private readonly engine: SyncEngine | null

  private constructor(
    private readonly db: Database,
    private readonly env: ClientEnv,
    private readonly l1: string,
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
    client.userId = await getUserId(db)
    client.xp = await readPulledXp(db.driver)
    await client.reloadDocuments()
    client.refresh()
    return client
  }

  get snapshot(): ClientSnapshot {
    return this.store.get()
  }

  private async reloadDocuments(): Promise<void> {
    this.settings = await readSettings(this.db.driver)
    this.flags = await readFlags(this.db.driver)
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
      now: this.env.now(),
      tzOffsetMin: this.env.tzOffsetMin(),
    }
  }

  private buildSnapshot(): ClientSnapshot {
    const ctx = this.context()
    const plan = ctx ? sessionPlan(ctx) : null
    const provisionalToday = provisionalXp(this.learner).byUtcDay.get(utcDay(this.env.now())) ?? 0
    const provisional = provisionalXp(this.learner).total
    const pulledToday = this.xp && this.xp.utcDay === utcDay(this.env.now()) ? this.xp.today : 0
    return {
      deviceId: this.learner.deviceId,
      userId: this.userId,
      corpus: this.corpus,
      states: this.learner.states,
      settings: this.settings,
      flags: this.flags,
      unlocked: this.unlocked,
      plan,
      progress: ctx && plan ? progressView(ctx, plan) : null,
      entitlement: this.entitlement,
      xp: { total: (this.xp?.total ?? 0) + provisional, today: pulledToday + provisionalToday, provisional },
      sync: this.engine?.status ?? INITIAL_SYNC_STATUS,
    }
  }

  private refresh(): void {
    this.store.set(this.buildSnapshot())
  }

  /** Fetches, verifies and stages newer packs for the learner's L1 (spec §5.1). Nothing changes until `startSession`. */
  installPacks(manifest: PackManifest, fetchPack: PackFetcher): Promise<InstallReport> {
    return installPacks(this.db, this.env, manifest, this.l1, fetchPack)
  }

  /** Swaps staged packs in and reloads the corpus. Call at the start of a session, never mid-session. */
  async startSession(): Promise<string[]> {
    const activated = await activateStagedPacks(this.db)
    if (activated.length > 0 || !this.corpus) this.corpus = await loadActiveCorpus(this.db)
    this.refresh()
    return activated
  }

  entry(wordId: WordId): CorpusEntry | null {
    return this.corpus ? entryOf(this.corpus, wordId) : null
  }

  availableModes(wordId: WordId, cachedClips: ReadonlySet<string>, online: boolean): Set<Mode> {
    const ctx = this.context()
    return ctx ? availableModes(ctx, wordId, cachedClips, online) : new Set<Mode>(['flashcard', 'multiple_choice'])
  }

  /** Records one answer, persists any new unit unlock, and records the completed day when it first becomes complete. */
  async answer(input: AnswerInput): Promise<AnswerResult> {
    const event = await appendAnswer(this.db, this.env, this.learner, input)
    const before = this.context()
    if (!before) {
      this.refresh()
      return { event, dayCompleted: false, unlocked: [] }
    }
    const unlocked = newUnlocks(before)
    if (unlocked.length > 0) {
      await this.db.transaction((tx) => addUnlocks(tx, unlocked))
      this.unlocked = new Set([...this.unlocked, ...unlocked])
    }
    const ctx = this.context()!
    const plan = sessionPlan(ctx)
    const dayCompleted = isDayComplete(dayCompleteInput(ctx, plan)) && (await recordDayComplete(this.db, this.learner, today(ctx), this.env.now()))
    this.refresh()
    return { event, dayCompleted, unlocked }
  }

  async updateSettings(patch: Record<string, unknown>): Promise<Settings> {
    this.settings = await this.db.transaction((tx) => patchSettings(tx, patch))
    this.refresh()
    return this.settings
  }

  async setFlag(wordId: WordId, flag: WordFlag | null): Promise<void> {
    await this.db.transaction((tx) => setFlag(tx, wordId, flag))
    this.flags = await readFlags(this.db.driver)
    this.refresh()
  }

  /** Files a content report; it syncs like any document (spec §8.10). */
  report(input: ContentReportInput): Promise<string> {
    return this.db.transaction((tx) => addContentReport(tx, this.env, input))
  }

  /** The one capability check (spec §8.8): the cached entitlement, honoured until its expiry. */
  canUse(capability: Capability): boolean {
    return canUse(capability, this.entitlement, this.env.now())
  }

  async sync(options: { force?: boolean } = {}): Promise<SyncOutcome> {
    if (!this.engine) return 'skipped'
    const outcome = await this.engine.sync(options)
    if (outcome === 'synced') {
      await this.reloadDocuments()
      this.xp = await readPulledXp(this.db.driver)
    }
    this.refresh()
    return outcome
  }

  /** Binds this database to an account (demo carry-over, spec §8.6). Every row stays. */
  async attachUser(userId: string): Promise<void> {
    await this.db.transaction((tx) => setUserId(tx, userId))
    this.userId = userId
    this.refresh()
  }

  close(): Promise<void> {
    return this.db.close()
  }
}
