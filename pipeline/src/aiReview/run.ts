import { readConfig, type AiReviewConfig } from '../config'
import { Decisions } from '../decisions'
import { readDraft } from '../draft'
import { AnswerDoesNotFit, type Llm } from '../llm'
import { mapLimit } from '../mapLimit'
import { pendingItems } from '../queues'
import { AI_REVIEW_VERSION, queueKind, reviewRequest, type ReviewRow } from './prompts'
import { reviewRows } from './rows'
import { AiReviewStore, rowContent, type AiVerdict } from './store'

export interface AiReviewRun {
  readonly dir: string
  readonly reviewer: string
  readonly queue?: string
  readonly llm: Llm
  readonly concurrency: number
  readonly now: () => string
}
export interface AiReviewSummary {
  readonly queue: string
  readonly asked: number
  readonly flagged: number
  readonly alreadyReviewed: number
}

const BATCH = 10

export function aiReviewConfig(dir: string): AiReviewConfig {
  const cfg = readConfig(dir).ai_review
  if (!cfg) throw new Error('pipeline.json has no ai_review block')
  return cfg
}

/** `corpus ai-review`: every open row of the AI-reviewed queues that this reviewer has not judged in its current form. */
export async function runAiReview(run: AiReviewRun): Promise<AiReviewSummary[]> {
  const config = readConfig(run.dir)
  const cfg = aiReviewConfig(run.dir)
  if (!(run.reviewer in cfg.reviewers)) throw new Error(`${run.reviewer} is not a reviewer in ai_review.reviewers`)
  if (run.queue !== undefined && !cfg.queues.includes(run.queue)) throw new Error(`${run.queue} is not in ai_review.queues`)
  const queues = run.queue !== undefined ? [run.queue] : cfg.queues
  const draft = readDraft(run.dir)
  const pending = pendingItems(draft, Decisions.read(run.dir), config.l1s)
  const store = AiReviewStore.read(run.dir)
  const out: AiReviewSummary[] = []
  for (const queue of queues) {
    const kind = queueKind(queue)!
    const items = pending.get(queue) ?? []
    const contentOf = new Map(items.map((i) => [i.key, rowContent(queue, i.proposed, i.context['reopened'] ?? '')]))
    const todo = items.filter((i) => !store.current(queue, i.key, run.reviewer, contentOf.get(i.key)!))
    const rows = reviewRows(queue, todo, draft, config.l1s)
    let flagged = 0
    const ask = async (batch: readonly ReviewRow[]): Promise<void> => {
      let verdicts
      try {
        verdicts = await run.llm.json(reviewRequest(queue, batch))
      } catch (err) {
        if (!(err instanceof AnswerDoesNotFit) || batch.length < 2) throw err
        const half = Math.ceil(batch.length / 2)
        await ask(batch.slice(0, half))
        await ask(batch.slice(half))
        return
      }
      const at = run.now()
      const lines: AiVerdict[] = verdicts.map((v) => ({
        key: v.key,
        reviewer: run.reviewer,
        model: run.llm.model,
        prompt_version: AI_REVIEW_VERSION[kind],
        content: contentOf.get(v.key)!,
        verdict: v.verdict,
        objections: v.objections,
        at,
      }))
      flagged += lines.filter((l) => l.verdict !== 'ok').length
      store.append(queue, lines)
    }
    const batches: ReviewRow[][] = []
    for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH))
    await mapLimit(batches, run.concurrency, ask)
    out.push({ queue, asked: rows.length, flagged, alreadyReviewed: items.length - todo.length })
  }
  return out
}
