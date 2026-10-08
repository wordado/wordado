import { buildMatchingBoard, corpusWordId, gradeAnswer, matchingCandidates, MATCHING_PAIRS, practiceWeight, scopePool, shuffle, type CorpusEntry, type PracticeScope } from '@wordado/core'
import type { Client } from './client'
import { createStore, type Store } from './store'
import type { RunEnv } from './run'

export type MatchingSide = 'left' | 'right'

export interface MatchingSnapshot {
  /** English headwords, in board order. */
  readonly left: readonly CorpusEntry[]
  /** The same entries, shuffled; shown by primary translation. */
  readonly right: readonly CorpusEntry[]
  /** Entry IDs matched so far. */
  readonly matched: ReadonlySet<string>
  readonly selected: { readonly side: MatchingSide; readonly entryId: string } | null
  /** The last pair that did not match, until the next selection. */
  readonly miss: { readonly left: string; readonly right: string } | null
  readonly done: boolean
  readonly error: string | null
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * One matching board (spec §8.1): a game, not a measurement, so every pair is
 * recorded with `practice = true` and never touches the schedule. A pair is
 * graded Again when either of its words was part of a wrong pairing first.
 */
export class MatchingRun {
  readonly store: Store<MatchingSnapshot>
  private readonly missed = new Set<string>()
  private lastAt: number
  // The UI's onClick never awaits `select` (spec §8.1: a game, kept snappy); a pairing's grading
  // write can still be in flight when the next one is clicked, so calls are queued, not dropped,
  // or a fast learner's (or e2e automation's) click on the next pair would be silently lost.
  private queue: Promise<void> = Promise.resolve()

  private constructor(
    private readonly client: Client,
    private readonly env: RunEnv,
    board: readonly CorpusEntry[],
  ) {
    this.lastAt = env.now()
    this.store = createStore<MatchingSnapshot>({
      left: board,
      right: shuffle(board, env.rng),
      matched: new Set(),
      selected: null,
      miss: null,
      done: false,
      error: null,
    })
  }

  /**
   * A board of MATCHING_PAIRS introduced words, or null until the learner has that many; of one unit or theme, when
   * `scope` names it, and of any of its words for a theme or a unit of a skipped level. Like every practice it leans
   * towards weaker words, and in a scope it deals the words the visit has not shown first (spec §7.4).
   */
  static start(client: Client, env: RunEnv, scope?: PracticeScope): MatchingRun | null {
    const { corpus, states, flags, settings } = client.snapshot
    if (!corpus) return null
    const wordId = (entry: CorpusEntry) => corpusWordId(entry.entryId)
    const weight = (entry: CorpusEntry) => practiceWeight(states.get(wordId(entry)))
    const pool = scopePool(corpus, settings.declaredLevel, scope)
    const candidates = matchingCandidates(corpus, states, flags, pool?.within, pool?.unstarted)
    // The scope the corpus holds: what its boards deal is remembered for the visit.
    const visitScope = pool ? scope : undefined
    const shown = visitScope && client.practiceVisit.begin(visitScope, candidates.map(wordId))
    const board = buildMatchingBoard(candidates, MATCHING_PAIRS, env.rng, weight, shown && ((entry) => shown.has(wordId(entry))))
    if (!board) return null
    if (visitScope) for (const entry of board) client.practiceVisit.show(visitScope, wordId(entry))
    return new MatchingRun(client, env, board)
  }

  get snapshot(): MatchingSnapshot {
    return this.store.get()
  }

  private set(patch: Partial<MatchingSnapshot>): void {
    this.store.set({ ...this.store.get(), ...patch })
  }

  /**
   * Selects a word on one side; a selection on the other side completes a pairing. Queued behind
   * any pairing still saving, so two selections made close together are both applied, in order.
   */
  select(side: MatchingSide, entryId: string): Promise<void> {
    const run = this.queue.then(() => this.selectNow(side, entryId))
    // A grading write's own failure already becomes `snapshot.error` inside `selectNow`; the
    // queue itself must never reject, or every pairing after a failed one would be dropped too.
    this.queue = run.catch(() => undefined)
    return run
  }

  private async selectNow(side: MatchingSide, entryId: string): Promise<void> {
    const s = this.snapshot
    if (s.done || s.matched.has(entryId)) return
    if (!s.left.some((e) => e.entryId === entryId)) return
    if (s.selected === null || s.selected.side === side) {
      this.set({ selected: { side, entryId }, miss: null })
      return
    }
    const left = side === 'left' ? entryId : s.selected.entryId
    const right = side === 'right' ? entryId : s.selected.entryId
    if (left !== right) {
      this.missed.add(left)
      this.missed.add(right)
      this.set({ selected: null, miss: { left, right } })
      return
    }
    try {
      const now = this.env.now()
      const latencyMs = Math.max(0, now - this.lastAt)
      const grade = gradeAnswer('matching', { kind: 'binary', correct: !this.missed.has(left), latencyMs }, { latencyGrading: false })
      await this.client.answer({ wordId: corpusWordId(left), mode: 'matching', direction: 'en_to_l1', grade, latencyMs, practice: true })
      this.lastAt = now
      const matched = new Set([...this.snapshot.matched, left])
      this.set({ matched, selected: null, miss: null, done: matched.size === this.snapshot.left.length, error: null })
    } catch (err) {
      this.set({ selected: null, error: messageOf(err) })
    }
  }
}
