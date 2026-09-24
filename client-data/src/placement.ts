import {
  buildItem,
  MIN_PLACEMENT_LEVELS,
  nextPlacementWords,
  placementLevels,
  placementPool,
  placementProgress,
  type CefrLevel,
  type ChoiceItem,
  type Corpus,
  type PlacementAnswer,
  type WordId,
} from '@wordado/core'
import type { Client } from './client'
import { ITEM_SETTLE_MS, type RunEnv } from './run'
import { createStore, type Store } from './store'

/** What a placement test needs: the words, and where the result goes. */
export interface PlacementSource {
  readonly corpus: Corpus | null
  setLevel(level: CefrLevel): Promise<void>
}

/** A Client as a placement source: the result becomes the declared level (spec §7.2). */
export function placementSource(client: Client): PlacementSource {
  return {
    corpus: client.snapshot.corpus,
    setLevel: async (level) => {
      await client.updateSettings({ declaredLevel: level })
    },
  }
}

/** Whether the corpus has the bands a test needs (spec §7.2). The A1-only sample has not. */
export function placementAvailable(corpus: Corpus | null): boolean {
  return corpus !== null && placementLevels(placementPool(corpus.entries.values())).length >= MIN_PLACEMENT_LEVELS
}

/** unavailable → question → … → result → (accept) accepted. */
export type PlacementPhase = 'unavailable' | 'question' | 'result' | 'accepted'

export interface PlacementSnapshot {
  readonly phase: PlacementPhase
  readonly item: ChoiceItem | null
  readonly asked: number
  /** The bands this test searches. */
  readonly levels: readonly CefrLevel[]
  readonly result: CefrLevel | null
  readonly error: string | null
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * The optional placement test (spec §7.2): multiple-choice questions, drawn
 * by `core`'s binary search over the bands the corpus ships, and a result the
 * learner accepts or leaves. Answers are not review events: the test
 * measures, it does not schedule, so nothing is written until `accept`.
 */
export class PlacementRun {
  readonly store: Store<PlacementSnapshot>
  private readonly answers: PlacementAnswer[] = []
  /** Words that could not be asked as a choice (too few distractors): never offered again. */
  private readonly unusable = new Set<WordId>()
  private readonly pool: Map<CefrLevel, WordId[]>
  private readonly levels: CefrLevel[]
  private shownAt = 0

  private constructor(
    private readonly source: PlacementSource,
    private readonly env: RunEnv,
  ) {
    const corpus = source.corpus
    this.pool = corpus ? placementPool(corpus.entries.values()) : new Map()
    this.levels = placementLevels(this.pool)
    this.store = createStore<PlacementSnapshot>({ phase: 'unavailable', item: null, asked: 0, levels: this.levels, result: null, error: null })
  }

  static start(source: PlacementSource, env: RunEnv): PlacementRun {
    const run = new PlacementRun(source, env)
    if (run.levels.length >= MIN_PLACEMENT_LEVELS) run.advance()
    return run
  }

  get snapshot(): PlacementSnapshot {
    return this.store.get()
  }

  private set(patch: Partial<PlacementSnapshot>): void {
    this.store.set({ ...this.store.get(), ...patch })
  }

  private advance(): void {
    const corpus = this.source.corpus!
    for (;;) {
      const progress = placementProgress(this.answers, this.levels)
      if (progress.probing === null) {
        this.set({ phase: 'result', item: null, result: progress.result })
        return
      }
      const pool = new Map([...this.pool].map(([level, ids]) => [level, ids.filter((id) => !this.unusable.has(id))]))
      const wordId = nextPlacementWords(this.answers, pool, this.env.rng, this.levels)[0]
      if (wordId === undefined) {
        // The band ran out of askable words before its probe was decided: place the learner there.
        this.set({ phase: 'result', item: null, result: progress.probing })
        return
      }
      const item = buildItem(wordId, {
        corpus,
        states: new Map(),
        available: new Set(['multiple_choice']),
        preferred: 'multiple_choice',
        rng: this.env.rng,
      })
      if (item === null || item.mode !== 'multiple_choice') {
        this.unusable.add(wordId)
        continue
      }
      // A placement question always shows the English word: it asks what the learner can read.
      const shown: ChoiceItem = item.direction === 'en_to_l1' ? item : { ...item, direction: 'en_to_l1' }
      this.shownAt = this.env.now()
      this.set({ phase: 'question', item: shown })
      return
    }
  }

  private record(correct: boolean): void {
    const { phase, item } = this.snapshot
    if (phase !== 'question' || !item) return
    if (this.env.now() - this.shownAt < ITEM_SETTLE_MS) return
    this.answers.push({ wordId: item.wordId, level: item.entry.level, correct })
    this.set({ asked: this.answers.length })
    this.advance()
  }

  choose(index: number): void {
    const item = this.snapshot.item
    if (!item || !Number.isInteger(index) || index < 0 || index >= item.options.length) return
    this.record(index === item.answerIndex)
  }

  /** "I don't know": a wrong answer, without the guess that would make the result lucky. */
  dontKnow(): void {
    this.record(false)
  }

  /** Makes the result the declared level; units below it become assumed known (spec §7.2). Nothing is deleted. */
  async accept(): Promise<void> {
    const { phase, result } = this.snapshot
    if (phase !== 'result' || result === null) return
    try {
      await this.source.setLevel(result)
      this.set({ phase: 'accepted', error: null })
    } catch (err) {
      this.set({ error: messageOf(err) })
    }
  }
}
