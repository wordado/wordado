import type { AiReviewConfig } from '../config'
import type { QueueItem } from '../queues'
import { rowContent, type AiReviewStore } from './store'
import { aiState } from './vote'

/** Lines for planRelease's pending list, per AI-reviewed queue: "<key>: not yet AI-reviewed (<queue>)" and "<key>: flagged by AI review, awaiting a decision (<queue>)". */
export function aiGate(cfg: AiReviewConfig | undefined, pending: ReadonlyMap<string, readonly QueueItem[]>, store: AiReviewStore): string[] {
  if (!cfg) return []
  const lines: string[] = []
  for (const queue of cfg.queues) {
    for (const item of pending.get(queue) ?? []) {
      const state = aiState(store, cfg, queue, item.key, rowContent(queue, item.proposed, item.context['reopened'] ?? ''))
      if (state.status === 'unreviewed') lines.push(`${item.key}: not yet AI-reviewed (${queue})`)
      else if (state.status === 'flagged') lines.push(`${item.key}: flagged by AI review, awaiting a decision (${queue})`)
    }
  }
  return lines
}
