import { readConfig } from '@wordado/pipeline/config'
import { contentPaths } from '@wordado/pipeline/content'
import { Decisions, QUEUES } from '@wordado/pipeline/decisions'
import { readDraft, runDraft } from '@wordado/pipeline/draft'
import { writeJson } from '@wordado/pipeline/files'
import { exportQueues, pendingItems, queueSpecs } from '@wordado/pipeline/queues'
import { makeContent, sampleLlm } from '@wordado/pipeline/testing/fixture'
import { AiReviewStore, rowContent } from '@wordado/pipeline/aiReview/store'

/** A drafted content dir with AI review on translation-bg and level: Flash objects to bank-*, passes the rest; one row reopened. */
export async function reviewFixture(): Promise<string> {
  const dir = makeContent()
  await runDraft({ dir, llm: sampleLlm(), offline: false })
  const config = readConfig(dir)
  writeJson(contentPaths(dir).config, {
    ...config,
    ai_review: { queues: ['translation-bg', 'level'], reviewers: { flash: { provider: 'openrouter', model: 'google/gemini-3.8-flash' } }, default: 'flash', flag_when: 1 },
  })
  const draft = readDraft(dir)
  const decisions = Decisions.read(dir)
  const reopenKey = draft.live.find((k) => !k.startsWith('bank-'))!
  decisions.append(QUEUES.translation('bg'), [{ key: reopenKey, at: '2026-10-04T00:00:00Z', verdict: 'reopen', by: 'reports', note: '1 report (translation): odd word' }])
  const items = pendingItems(draft, Decisions.read(dir), config.l1s)
  exportQueues(dir, items, queueSpecs(config.l1s), { stamp: '2026-10-04' })
  const store = AiReviewStore.read(dir)
  for (const queue of ['translation-bg', 'level']) {
    store.append(
      queue,
      (items.get(queue) ?? []).map((i) => {
        const bad = i.key.startsWith('bank-')
        const field = queue === 'level' ? 'level' : 'translation'
        return {
          key: i.key, reviewer: 'flash', model: 'google/gemini-3.8-flash', prompt_version: 1,
          content: rowContent(queue, i.proposed, i.context['reopened'] ?? ''),
          verdict: bad ? ('major' as const) : ('ok' as const),
          objections: bad ? [{ field, category: queue === 'level' ? 'too-low' : 'wrong-sense', severity: 'major' as const, reason: 'wrong meaning', fix: queue === 'level' ? 'B2' : 'брег' }] : [],
          at: '2026-10-04T01:00:00Z',
        }
      }),
    )
  }
  return dir
}
