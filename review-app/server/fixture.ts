import { renameSync } from 'node:fs'
import { join } from 'node:path'
import { readConfig } from '@wordado/pipeline/config'
import { contentPaths } from '@wordado/pipeline/content'
import { Decisions, QUEUES } from '@wordado/pipeline/decisions'
import { readDraft, runDraft } from '@wordado/pipeline/draft'
import { writeJson } from '@wordado/pipeline/files'
import { profileOf } from '@wordado/pipeline/profiles'
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
    ai_review: { queues: ['translation-bg', 'level'], ...AI_REVIEW },
  })
  const draft = readDraft(dir)
  const decisions = Decisions.read(dir)
  const reopenKey = draft.live.find((k) => !k.startsWith('bank-'))!
  decisions.append(QUEUES.translation('bg'), [{ key: reopenKey, at: '2026-10-04T00:00:00Z', verdict: 'reopen', by: 'reports', note: '1 report (translation): odd word' }])
  const items = pendingItems(draft, Decisions.read(dir), config.l1s, profileOf(config))
  exportQueues(dir, items, queueSpecs(config.l1s, profileOf(config)), { stamp: '2026-10-04' })
  flashVerdicts(dir, items, ['translation-bg', 'level'], (key) => key.startsWith('bank-'))
  return dir
}

const AI_REVIEW = { reviewers: { flash: { provider: 'openrouter', model: 'google/gemini-3.8-flash' } }, default: 'flash', flag_when: 1 }

/** Flash's verdicts on the queues' pending rows: a major objection to the rows `bad` picks, none to the rest. */
function flashVerdicts(dir: string, items: ReturnType<typeof pendingItems>, queues: readonly string[], bad: (key: string) => boolean): void {
  const store = AiReviewStore.read(dir)
  const fixes: Readonly<Record<string, readonly [field: string, category: string, fix: string]>> = { level: ['level', 'too-low', 'B2'], grammar: ['gender', 'gender', 'f'] }
  for (const queue of queues) {
    const [field, category, fix] = fixes[queue] ?? ['translation', 'wrong-sense', 'брег']
    store.append(
      queue,
      (items.get(queue) ?? []).map((i) => ({
        key: i.key, reviewer: 'flash', model: 'google/gemini-3.8-flash', prompt_version: 1,
        content: rowContent(queue, i.proposed, i.context['reopened'] ?? ''),
        verdict: bad(i.key) ? ('major' as const) : ('ok' as const),
        objections: bad(i.key) ? [{ field, category, severity: 'major' as const, reason: 'wrong meaning', fix }] : [],
        at: '2026-10-04T01:00:00Z',
      })),
    )
  }
}

/** reviewFixture with a German corpus in de/ (spec §5.5), drafted, with AI review on its translation-bg, translation-en,
 * level and grammar: Flash objects to every other row. */
export async function germanFixture(): Promise<string> {
  const dir = await reviewFixture()
  const de = join(dir, 'de')
  renameSync(makeContent({ config: { target: 'de', l1s: ['bg', 'en'] } }), de)
  await runDraft({ dir: de, llm: sampleLlm({ grammar: true }), offline: false })
  const queues = ['translation-bg', 'translation-en', 'level', 'grammar']
  const config = readConfig(de)
  writeJson(contentPaths(de).config, { ...config, ai_review: { queues, ...AI_REVIEW } })
  const items = pendingItems(readDraft(de), Decisions.read(de), config.l1s, profileOf(config))
  exportQueues(de, items, queueSpecs(config.l1s, profileOf(config)), { stamp: '2026-10-04' })
  let n = 0
  flashVerdicts(de, items, queues, () => n++ % 2 === 0)
  return dir
}
