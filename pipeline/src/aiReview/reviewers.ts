import type { AiReviewer } from '../config'
import { openRouterLlm, type Llm } from '../llm'
import { localLlm } from '../localLlm'

/** The Llm for one configured reviewer. The OpenRouter key is asked for only when the reviewer needs it. */
export function reviewerLlm(r: AiReviewer, opts: { maxUsd: number; apiKey: () => string; fetch?: typeof fetch }): Llm {
  if (r.provider === 'local') return localLlm({ url: r.url ?? '', model: r.model, ...(opts.fetch ? { fetch: opts.fetch } : {}) })
  return openRouterLlm({ apiKey: opts.apiKey(), model: r.model, maxUsd: opts.maxUsd, ...(opts.fetch ? { fetch: opts.fetch } : {}) })
}
