import { readdirSync } from 'node:fs'
import { basename } from 'node:path'
import { canonicalJson } from '@wordado/core'
import { contentPaths } from './content'
import { appendJsonl, readJsonl } from './files'

export type Verdict = 'ok' | 'fix' | 'drop' | 'reopen' | 'redo'

/** One reviewer or triage verdict on one item of one queue (Decision 5). Append-only. */
export interface DecisionEvent {
  /** An entry ID, a unit ID (title queues) or a clip ID (audio). */
  readonly key: string
  /** ISO 8601. */
  readonly at: string
  readonly verdict: Verdict
  /** The value the reviewer saw; ok, fix and drop apply only while it is still the value. */
  readonly proposed?: unknown
  /** The corrected value, for fix. */
  readonly value?: unknown
  /** The reviewer's name, or "reports" for triage. */
  readonly by: string
  readonly note?: string
}

export interface FieldState<T> {
  readonly value: T
  readonly reviewed: boolean
  readonly dropped: boolean
  /** Reports sent it back to review (spec §8.10). */
  readonly reopened: boolean
  /** Verdicts on a proposal that is no longer current. */
  readonly stale: number
}

export const QUEUES = {
  english: 'english',
  level: 'level',
  audio: 'audio',
  translation: (l1: string) => `translation-${l1}`,
  title: (l1: string) => `title-${l1}`,
} as const

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)

/** A field's value and review state: its proposal with its events replayed in order. */
export function foldField<T>(proposal: T, events: readonly DecisionEvent[]): FieldState<T> {
  let value = proposal
  let reviewed = false
  let dropped = false
  let reopened = false
  let stale = 0
  for (const e of events) {
    if (e.verdict === 'reopen') {
      reviewed = false
      reopened = true
      continue
    }
    if (e.verdict === 'redo') continue
    if (!same(e.proposed, value)) {
      stale += 1
      continue
    }
    if (e.verdict === 'fix') value = e.value as T
    if (e.verdict === 'drop') dropped = true
    reviewed = true
    reopened = false
  }
  return { value, reviewed, dropped, reopened, stale }
}

/** Every queue's events, read once per command. */
export class Decisions {
  private constructor(
    private readonly dir: string,
    private readonly byQueue: Map<string, DecisionEvent[]>,
  ) {}

  static read(dir: string): Decisions {
    const paths = contentPaths(dir)
    const byQueue = new Map<string, DecisionEvent[]>()
    let files: string[] = []
    try {
      files = readdirSync(paths.decisionsDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      files = []
    }
    for (const f of files) byQueue.set(basename(f, '.jsonl'), readJsonl<DecisionEvent>(paths.decisions(basename(f, '.jsonl'))))
    return new Decisions(dir, byQueue)
  }

  all(queue: string): readonly DecisionEvent[] {
    return this.byQueue.get(queue) ?? []
  }

  for(queue: string, key: string): readonly DecisionEvent[] {
    return this.all(queue).filter((e) => e.key === key)
  }

  append(queue: string, events: readonly DecisionEvent[]): void {
    appendJsonl(contentPaths(this.dir).decisions(queue), events)
    this.byQueue.set(queue, [...this.all(queue), ...events])
  }
}
