import { buildItem, gradeAnswer, practiceWords, type Grade, type Mode, type StudyItem, type WordId } from '@wordado/core'
import type { Client } from './client'
import type { ClientEnv } from './env'
import { createStore, type Store } from './store'

/** Words in one practice run (spec §7.4). Tuning (§15). */
export const PRACTICE_RUN_SIZE = 10

/** A run's clock and randomness: the app's `ClientEnv`. */
export type RunEnv = Pick<ClientEnv, 'now' | 'rng'>

/** A scheduled session, or extra practice, which never touches the schedule (spec §7.4). */
export type RunKind = 'session' | 'practice'

export interface RunOptions {
  readonly kind: RunKind
  /** A single-mode run by the learner's choice; null for the mixed default (spec §7.4). */
  readonly mode: Mode | null
  /** Asked per item, so a clip cached mid-run counts (spec §9.3). */
  cachedClips(): ReadonlySet<string>
  online(): boolean
}

/**
 * prompt → (flashcard) revealed → rated → next prompt;
 * prompt → (choice) feedback → next prompt; done when nothing is left.
 */
export type RunPhase = 'prompt' | 'revealed' | 'feedback' | 'done'

export interface RunFeedback {
  readonly correct: boolean
  readonly chosen: number
  readonly grade: Grade
}

export interface RunSnapshot {
  readonly phase: RunPhase
  readonly item: StudyItem | null
  readonly feedback: RunFeedback | null
  readonly answered: number
  /** Items left as of now. A word answered Again comes back after the relearn delay and raises it. */
  readonly remaining: number
  /** True once an answer in this run completed the day (spec §8.4). */
  readonly dayCompleted: boolean
  /** Units this run unlocked, in order (spec §7.2). */
  readonly unlocked: readonly string[]
  /** Why the last answer was not recorded; the item stays so it can be answered again. */
  readonly error: string | null
}

const INITIAL: RunSnapshot = {
  phase: 'done',
  item: null,
  feedback: null,
  answered: 0,
  remaining: 0,
  dayCompleted: false,
  unlocked: [],
  error: null,
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * One study run over a `Client` (spec §7.4, §8.1). A session reads its next
 * word from the live plan after every answer — reviews first, then new words —
 * so a word answered Again returns once it is due again, and the run ends when
 * nothing is due now. A practice run draws PRACTICE_RUN_SIZE introduced words
 * that today's session does not serve, and records them as practice.
 */
export class StudyRun {
  readonly store: Store<RunSnapshot> = createStore(INITIAL)
  private shownAt = 0
  private presentedAt: number | null = null
  private busy = false
  private readonly skipped = new Set<WordId>()
  private practiceQueue: WordId[] = []

  private constructor(
    private readonly client: Client,
    private readonly env: RunEnv,
    private readonly options: RunOptions,
  ) {}

  /** Starts a run: swaps in any staged pack first (spec §5.1), then shows the first item. */
  static async start(client: Client, env: RunEnv, options: RunOptions): Promise<StudyRun> {
    await client.startSession()
    const run = new StudyRun(client, env, options)
    if (options.kind === 'practice') {
      const { states, flags, plan } = client.snapshot
      const exclude = new Set<WordId>([...(plan?.reviews ?? []), ...(plan?.newWords ?? [])])
      run.practiceQueue = practiceWords({ states, flags, exclude, count: PRACTICE_RUN_SIZE, rng: env.rng })
    }
    run.advance()
    return run
  }

  get snapshot(): RunSnapshot {
    return this.store.get()
  }

  private set(patch: Partial<RunSnapshot>): void {
    this.store.set({ ...this.store.get(), ...patch })
  }

  private queue(): WordId[] {
    if (this.options.kind === 'practice') return this.practiceQueue.filter((w) => !this.skipped.has(w))
    const plan = this.client.snapshot.plan
    return plan ? [...plan.reviews, ...plan.newWords].filter((w) => !this.skipped.has(w)) : []
  }

  private itemFor(wordId: WordId): StudyItem | null {
    const { corpus, states } = this.client.snapshot
    if (!corpus) return null
    const available = this.client.availableModes(wordId, this.options.cachedClips(), this.options.online())
    return buildItem(wordId, { corpus, states, available, preferred: this.options.mode, rng: this.env.rng })
  }

  private advance(): void {
    for (;;) {
      const queue = this.queue()
      const wordId = queue[0]
      if (wordId === undefined) {
        this.set({ phase: 'done', item: null, feedback: null, remaining: 0 })
        return
      }
      const item = this.itemFor(wordId)
      if (item === null) {
        // Not in the corpus (a Phase 2 user word): skip it rather than stall.
        this.skipped.add(wordId)
        continue
      }
      this.shownAt = this.env.now()
      this.presentedAt = null
      this.set({ phase: 'prompt', item, feedback: null, remaining: queue.length })
      return
    }
  }

  /** The prompt is fully presented (for listening, the audio has ended): latency counts from here (spec §7.3). */
  presented(): void {
    if (this.presentedAt === null) this.presentedAt = this.env.now()
  }

  private latency(): number {
    return Math.max(0, this.env.now() - (this.presentedAt ?? this.shownAt))
  }

  /** Shows a flashcard's answer. */
  reveal(): void {
    const { phase, item } = this.snapshot
    if (phase !== 'prompt' || item?.mode !== 'flashcard') return
    this.presented()
    this.set({ phase: 'revealed' })
  }

  /** A flashcard's self-rating, passed through (spec §7.3). Moves straight on. */
  async rate(rating: Grade): Promise<void> {
    const { phase, item } = this.snapshot
    if (phase !== 'revealed' || item?.mode !== 'flashcard') return
    const grade = gradeAnswer('flashcard', { kind: 'self_rated', rating }, { latencyGrading: true })
    if (await this.record(item, grade)) this.advance()
  }

  /** Picks an option of a choice item; binary grading with latency (spec §7.3). Shows feedback. */
  async choose(index: number): Promise<void> {
    const { phase, item } = this.snapshot
    if (phase !== 'prompt' || !item || item.mode === 'flashcard') return
    if (!Number.isInteger(index) || index < 0 || index >= item.options.length) return
    const correct = index === item.answerIndex
    const grade = gradeAnswer(item.mode, { kind: 'binary', correct, latencyMs: this.latency() }, { latencyGrading: true })
    if (await this.record(item, grade)) this.set({ phase: 'feedback', feedback: { correct, chosen: index, grade } })
  }

  /** Leaves the feedback for the next item. */
  next(): void {
    if (this.snapshot.phase === 'feedback') this.advance()
  }

  /** Ends the run now; every answer given so far is already recorded. */
  finish(): void {
    this.set({ phase: 'done', item: null, feedback: null, remaining: 0 })
  }

  /** One answer at a time: a second press while the first is being written is ignored. */
  private async record(item: StudyItem, grade: Grade): Promise<boolean> {
    if (this.busy) return false
    this.busy = true
    try {
      const practice = this.options.kind === 'practice'
      const result = await this.client.answer({
        wordId: item.wordId,
        mode: item.mode,
        direction: item.direction,
        grade,
        latencyMs: this.latency(),
        practice,
      })
      if (practice) this.practiceQueue = this.practiceQueue.filter((w) => w !== item.wordId)
      const s = this.snapshot
      this.set({
        answered: s.answered + 1,
        // The answered word has left the queue unless it is due again already.
        remaining: this.queue().length,
        dayCompleted: s.dayCompleted || result.dayCompleted,
        unlocked: [...s.unlocked, ...result.unlocked],
        error: null,
      })
      return true
    } catch (err) {
      this.set({ error: messageOf(err) })
      return false
    } finally {
      this.busy = false
    }
  }
}
