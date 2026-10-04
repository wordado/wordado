import { canonicalJson } from '@wordado/core'
import { sha256Hex } from '../checksum'
import { contentPaths } from '../content'
import { appendJsonl, readJsonl } from '../files'
import { AI_REVIEW_VERSION, queueKind, type AiVerdictKind, type Objection } from './prompts'

export interface AiVerdict {
  readonly key: string
  readonly reviewer: string
  readonly model: string
  readonly prompt_version: number
  readonly content: string
  readonly verdict: AiVerdictKind
  readonly objections: readonly Objection[]
  readonly at: string
}

export function rowContent(queue: string, proposed: unknown, reopened: string): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson({ queue, proposed, reopened })))
}

/** ai-review/<queue>.jsonl, append-only (spec 2026-10-04 §3.5). */
export class AiReviewStore {
  private readonly byQueue = new Map<string, AiVerdict[]>()
  private constructor(private readonly dir: string) {}

  static read(dir: string): AiReviewStore {
    return new AiReviewStore(dir)
  }

  private lines(queue: string): AiVerdict[] {
    let lines = this.byQueue.get(queue)
    if (!lines) {
      lines = readJsonl<AiVerdict>(contentPaths(this.dir).aiReview(queue))
      this.byQueue.set(queue, lines)
    }
    return lines
  }

  append(queue: string, verdicts: readonly AiVerdict[]): void {
    if (verdicts.length === 0) return
    appendJsonl(contentPaths(this.dir).aiReview(queue), verdicts)
    this.lines(queue).push(...verdicts)
  }

  current(queue: string, key: string, reviewer: string, content: string): AiVerdict | undefined {
    const kind = queueKind(queue)
    if (!kind) return undefined
    const version = AI_REVIEW_VERSION[kind]
    const lines = this.lines(queue)
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const l = lines[i]!
      if (l.key === key && l.reviewer === reviewer && l.content === content && l.prompt_version === version) return l
    }
    return undefined
  }
}
