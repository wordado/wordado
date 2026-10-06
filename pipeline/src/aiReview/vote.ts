import { aiReviewRequired, type AiReviewConfig } from '../config'
import type { AiReviewStore, AiVerdict } from './store'

export type AiState =
  | { readonly status: 'unreviewed'; readonly missing: readonly string[] }
  | { readonly status: 'passed' | 'flagged'; readonly verdicts: readonly AiVerdict[] }

export function aiState(store: AiReviewStore, cfg: AiReviewConfig, queue: string, key: string, content: string): AiState {
  const required = aiReviewRequired(cfg)
  const verdicts: AiVerdict[] = []
  const missing: string[] = []
  for (const r of required) {
    const v = store.current(queue, key, r, content)
    if (v) verdicts.push(v)
    else missing.push(r)
  }
  if (missing.length > 0) return { status: 'unreviewed', missing }
  // flag_severity major: only major verdicts count, so minor objections stay visible without gating the release.
  const objects = (v: AiVerdict) => (cfg.flag_severity === 'major' ? v.verdict === 'major' : v.verdict !== 'ok')
  const objecting = verdicts.filter(objects).length
  return { status: objecting >= cfg.flag_when ? 'flagged' : 'passed', verdicts }
}

export function allVerdicts(store: AiReviewStore, cfg: AiReviewConfig, queue: string, key: string, content: string): AiVerdict[] {
  return Object.keys(cfg.reviewers)
    .map((r) => store.current(queue, key, r, content))
    .filter((v): v is AiVerdict => v !== undefined)
}
