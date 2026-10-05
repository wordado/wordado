import { norm } from '@wordado/core'
import type { Draft } from '../draft'
import { queueSpecs, type QueueItem } from '../queues'
import { queueKind, type ReviewRow } from './prompts'

/** The review rows of one queue's open items, with the context the reviewer needs. */
export function reviewRows(queue: string, items: readonly QueueItem[], draft: Draft, l1s: readonly string[]): ReviewRow[] {
  const kind = queueKind(queue)
  const spec = queueSpecs(l1s).get(queue)
  if (!kind || !spec) throw new Error(`${queue} is not a queue AI review covers`)
  const live = new Set(draft.live)
  const byId = new Map(draft.entries.map((e) => [e.entry_id, e]))
  const l1 = queue.split('-')[1] ?? ''
  const siblings = new Map<string, string[]>()
  for (const e of draft.entries) {
    if (!live.has(e.entry_id)) continue
    const k = `${norm(e.headword)}|${e.pos}`
    siblings.set(k, [...(siblings.get(k) ?? []), e.entry_id])
  }
  return items.map((item) => {
    const cells = spec.toCells(item.proposed)
    const learner_reports = item.context['reopened'] ?? ''
    if (kind === 'title') return { key: item.key, cells, context: { level: item.context['level'] ?? '', words: item.context['words'] ?? '', learner_reports } }
    const e = byId.get(item.key)
    const example = e?.english.examples[0] ?? item.context['example'] ?? ''
    if (kind === 'level') {
      return { key: item.key, cells, context: { headword: item.context['headword'] ?? '', pos: item.context['pos'] ?? '', sense_en: item.context['sense_en'] ?? '', example, band: item.context['band'] ?? '', learner_reports } }
    }
    const others = e ? (siblings.get(`${norm(e.headword)}|${e.pos}`) ?? []).filter((id) => id !== item.key) : []
    return {
      key: item.key,
      cells,
      context: {
        headword: item.context['headword'] ?? '',
        pos: item.context['pos'] ?? '',
        sense_en: item.context['sense_en'] ?? '',
        level: item.context['level'] ?? '',
        example,
        other_live_senses: others.map((id) => ({ key: id, translation: byId.get(id)?.l1[l1]?.translation ?? '', sense_en: byId.get(id)?.sense_en ?? '' })),
        learner_reports,
      },
    }
  })
}
