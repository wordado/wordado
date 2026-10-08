import { buildItem, gradeAnswer, practiceCandidates, practiceWords, scopePool, type Grade, type Mode, type PracticeInput, type PracticeScope, type StudyItem, type WordFlag, type WordId } from '@wordado/core'
import type { Client, ClientSnapshot } from './client'
import type { ClientEnv } from './env'
import { createStore, type Store } from './store'

/** Words in one practice run (spec §7.4). Tuning (§15). */
export const PRACTICE_RUN_SIZE = 10

/**
 * How long a freshly shown item ignores `choose`, `reveal` and `rate` (and
 * feedback ignores `next`), so a rating or a held key that lands right after
 * the view has already moved on cannot answer what it moved on to. Tuning
 * (spec §15): well below the 400 ms floor a real answer needs to be plausible.
 */
export const ITEM_SETTLE_MS = 250

/** A run's clock and randomness: the app's `ClientEnv`. */
export type RunEnv = Pick<ClientEnv, 'now' | 'rng'>

/** A scheduled session, or extra practice, which never touches the schedule (spec §7.4). */
export type RunKind = 'session' | 'practice'

export interface RunOptions {
  readonly kind: RunKind
  /** A single-mode run by the learner's choice; null for the mixed default (spec §7.4). */
  readonly mode: Mode | null
  /** Practice of one unit or theme (spec §7.4): the run keeps to its words. Ignored by a session, and when the corpus holds no such unit or theme. */
  readonly scope?: PracticeScope
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
  /** Words set aside ("I know this", "Not now") in this run (spec §7.4). */
  readonly setAside: number
  /** Words this run showed that are marked with "Learn this word" (spec §7.4), whenever they were marked. */
  readonly toLearn: number
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
  setAside: 0,
  toLearn: 0,
  remaining: 0,
  dayCompleted: false,
  unlocked: [],
  error: null,
}

/** What a practice run draws from now: the learner's words, without today's session, kept to the scope if the corpus holds it. */
function practiceInput(snapshot: ClientSnapshot, scope: PracticeScope | undefined): Omit<PracticeInput, 'count' | 'rng' | 'shown'> {
  const { states, flags, plan, corpus, settings } = snapshot
  const exclude = new Set<WordId>([...(plan?.reviews ?? []), ...(plan?.newWords ?? [])])
  return { states, flags, retired: corpus?.retired ?? new Set(), exclude, ...scopePool(corpus, settings.declaredLevel, scope) }
}

/**
 * How far this visit has gone through the practice of a unit or theme (spec §7.4): how many of the words a run
 * would draw from now it has already shown. Null for practice over everything, which keeps no such memory.
 */
export function visitProgress(client: Client, scope: PracticeScope | undefined): { readonly seen: number; readonly total: number } | null {
  const input = practiceInput(client.snapshot, scope)
  if (!scope || !input.within) return null
  const candidates = practiceCandidates(input)
  return { seen: client.practiceVisit.seen(scope, candidates), total: candidates.length }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * One study run over a `Client` (spec §7.4, §8.1). A session reads its next
 * word from the live plan after every answer — reviews first, then new words —
 * so a word answered Again returns once it is due again, and the run ends when
 * nothing is due now. A practice run draws PRACTICE_RUN_SIZE introduced words
 * (of one unit or theme, when `scope` names it), leaning towards the weaker
 * ones, and records them as practice. It leaves out the words today's session
 * serves unless nothing else is left. A theme, and a unit of a skipped level,
 * is practised whole: its words need not be started, and practising them
 * starts none. Within one visit a scope's runs take the words not yet shown
 * first (`PracticeVisit`), so they cover it before any word repeats.
 */
export class StudyRun {
  readonly store: Store<RunSnapshot> = createStore(INITIAL)
  private shownAt = 0
  private presentedAt: number | null = null
  /** When the current item's feedback phase began; `next()`'s own settle reference. */
  private feedbackAt: number | null = null
  /** When the current flashcard's answer was revealed: `rate()`'s own settle reference. */
  private revealedAt: number | null = null
  /** Set while the report dialog is open (spec §8.10); excluded from latency, not from the settle check. */
  private pausedAt: number | null = null
  /** Total time paused for the current item so far; subtracted from latency only. */
  private pausedMs = 0
  private busy = false
  /** A "Learn this word" change is being saved: a second press waits its turn by being ignored. */
  private marking = false
  private finished = false
  private readonly skipped = new Set<WordId>()
  /** Every word this run has shown: what its count of words to learn is taken over. */
  private readonly shown = new Set<WordId>()
  private practiceQueue: WordId[] = []
  /** The unit or theme this practice run keeps to, when the corpus holds it: what it shows is remembered for the visit. */
  private visitScope: PracticeScope | undefined

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
      const input = practiceInput(client.snapshot, options.scope)
      run.visitScope = input.within ? options.scope : undefined
      const shown = run.visitScope && client.practiceVisit.begin(run.visitScope, practiceCandidates(input))
      run.practiceQueue = practiceWords({ ...input, ...(shown && { shown }), count: PRACTICE_RUN_SIZE, rng: env.rng })
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
        this.set({ phase: 'done', item: null, feedback: null, remaining: 0, toLearn: this.learnCount() })
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
      this.feedbackAt = null
      this.revealedAt = null
      this.pausedAt = null
      this.pausedMs = 0
      this.shown.add(wordId)
      if (this.visitScope) this.client.practiceVisit.show(this.visitScope, wordId)
      this.set({ phase: 'prompt', item, feedback: null, remaining: queue.length, toLearn: this.learnCount() })
      return
    }
  }

  /** How many of the words shown so far are marked to learn now. */
  private learnCount(): number {
    const marked = new Set(this.client.snapshot.toLearn)
    return [...this.shown].filter((wordId) => marked.has(wordId)).length
  }

  /** Whether at least ITEM_SETTLE_MS has passed since `reference`, on this run's clock. */
  private settled(reference: number): boolean {
    return this.env.now() - reference >= ITEM_SETTLE_MS
  }

  /**
   * The prompt is fully presented (for listening, the audio has ended):
   * latency counts from here (spec §7.3). A flashcard's front is presented
   * the moment it is shown (`shownAt`), so a flashcard view need not call
   * this; the reveal shows the answer, not the prompt.
   */
  presented(): void {
    if (this.presentedAt === null) this.presentedAt = this.env.now()
  }

  private latency(): number {
    return Math.max(0, this.env.now() - (this.presentedAt ?? this.shownAt) - this.pausedMs)
  }

  /** The learner's setting (spec §11.1), read per answer so a change mid-run applies at once. */
  private latencyGrading(): boolean {
    return this.client.snapshot.settings.latencyGrading
  }

  /** Shows a flashcard's answer. Latency keeps counting from the prompt, not from here (spec §7.3). */
  reveal(): void {
    const { phase, item } = this.snapshot
    if (phase !== 'prompt' || item?.mode !== 'flashcard') return
    if (!this.settled(this.shownAt)) return
    this.revealedAt = this.env.now()
    this.set({ phase: 'revealed' })
  }

  /**
   * A flashcard's self-rating, passed through (spec §7.3). Ignored within the
   * settle time of the reveal, so a double tap on "Show answer" cannot land on
   * a rating. Moves straight on, unless `finish` ended the run meanwhile.
   */
  async rate(rating: Grade): Promise<void> {
    const { phase, item } = this.snapshot
    if (phase !== 'revealed' || item?.mode !== 'flashcard') return
    if (!this.settled(this.revealedAt ?? this.shownAt)) return
    const grade = gradeAnswer('flashcard', { kind: 'self_rated', rating }, { latencyGrading: this.latencyGrading() })
    if ((await this.record(item, grade)) && !this.finished) this.advance()
  }

  /** Picks an option of a choice item; binary grading with latency (spec §7.3). Shows feedback, unless `finish` ended the run meanwhile. */
  async choose(index: number): Promise<void> {
    const { phase, item } = this.snapshot
    if (phase !== 'prompt' || !item || item.mode === 'flashcard') return
    if (!Number.isInteger(index) || index < 0 || index >= item.options.length) return
    if (!this.settled(this.shownAt)) return
    const correct = index === item.answerIndex
    const grade = gradeAnswer(item.mode, { kind: 'binary', correct, latencyMs: this.latency() }, { latencyGrading: this.latencyGrading() })
    if ((await this.record(item, grade)) && !this.finished) {
      this.feedbackAt = this.env.now()
      this.set({ phase: 'feedback', feedback: { correct, chosen: index, grade } })
    }
  }

  /** Leaves the feedback for the next item. */
  next(): void {
    if (this.snapshot.phase !== 'feedback') return
    if (!this.settled(this.feedbackAt ?? this.shownAt)) return
    this.advance()
  }

  /**
   * "I know this" or "Not now" for the word on screen (spec §7.4): flags it,
   * records no answer, and moves on. The flag leaves the word out of every
   * later plan and practice run until the learner brings it back.
   */
  async setAside(flag: WordFlag): Promise<void> {
    const { phase, item } = this.snapshot
    if (!item || (phase !== 'prompt' && phase !== 'revealed')) return
    if (this.busy) return
    this.busy = true
    try {
      await this.client.setFlag(item.wordId, flag)
    } catch (err) {
      this.set({ error: messageOf(err) })
      return
    } finally {
      this.busy = false
    }
    this.skipped.add(item.wordId)
    this.practiceQueue = this.practiceQueue.filter((w) => w !== item.wordId)
    this.set({ setAside: this.snapshot.setAside + 1, toLearn: this.learnCount(), error: null })
    if (!this.finished) this.advance()
  }

  /**
   * "Learn this word" for the word on screen, or taking it back (spec §7.4): the daily session will serve it as a
   * new word. Offered in practice of a theme or of a skipped level's unit, on a word that was never started; allowed at any
   * point of the item, the feedback after an answer included. The run itself goes on as it was.
   */
  async setLearn(on: boolean): Promise<void> {
    const { item } = this.snapshot
    if (!item || this.marking) return
    this.marking = true
    try {
      await this.client.setToLearn(item.wordId, on)
    } catch (err) {
      this.set({ error: messageOf(err) })
      return
    } finally {
      this.marking = false
    }
    this.set({ toLearn: this.learnCount(), error: null })
  }

  /**
   * The report dialog is open (spec §8.10): thinking time stops counting.
   * `resume` excludes it from the current item's latency; the settle check is
   * based on when the item (or its feedback) first appeared, not on active
   * time, so it is never reopened by a pause.
   */
  pause(): void {
    if (this.pausedAt === null) this.pausedAt = this.env.now()
  }

  resume(): void {
    if (this.pausedAt === null) return
    this.pausedMs += this.env.now() - this.pausedAt
    this.pausedAt = null
  }

  /** Ends the run now; every answer given so far is already recorded, and one still being saved is not undone. */
  finish(): void {
    this.finished = true
    this.set({ phase: 'done', item: null, feedback: null, remaining: 0, toLearn: this.learnCount() })
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
        // Finished meanwhile: the count is already 0 and stays put, not recomputed from a queue this run no longer serves.
        remaining: this.finished ? s.remaining : this.queue().length,
        dayCompleted: s.dayCompleted || result.dayCompleted,
        // Practice introduces nothing, so it unlocks nothing: what its answer persisted was owed from before (a change of level).
        unlocked: practice ? s.unlocked : [...s.unlocked, ...result.unlocked],
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
