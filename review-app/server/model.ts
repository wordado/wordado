import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { norm } from '@wordado/core'
import { aiReviewRequired, readConfig, type AiReviewConfig } from '@wordado/pipeline/config'
import { contentPaths } from '@wordado/pipeline/content'
import { csvRecords } from '@wordado/pipeline/csv'
import { readDraft } from '@wordado/pipeline/draft'
import { readJson } from '@wordado/pipeline/files'
import { FIELDS, queueKind } from '@wordado/pipeline/aiReview/prompts'
import { AiReviewStore, rowContent } from '@wordado/pipeline/aiReview/store'
import { aiState, allVerdicts } from '@wordado/pipeline/aiReview/vote'
import type { QueueSummary, RowView } from './types'

export const fileVersion = (text: string) => createHash('sha256').update(text).digest('hex')

interface Sidecar { readonly items: readonly { readonly key: string; readonly proposed: unknown }[] }

function aiConfig(dir: string): AiReviewConfig {
  const cfg = readConfig(dir).ai_review
  if (!cfg) throw new Error('pipeline.json has no ai_review block: add one (pipeline/README.md, "AI review")')
  return cfg
}

/** Every row of every open file of one queue, as the app shows it. */
function rowsOf(dir: string, queue: string): RowView[] {
  const kind = queueKind(queue)
  if (!kind) return []
  const cfg = aiConfig(dir)
  const qdir = contentPaths(dir).queueDir(queue)
  if (!existsSync(qdir)) return []
  const store = AiReviewStore.read(dir)
  const draft = readDraft(dir)
  const live = new Set(draft.live)
  const byId = new Map(draft.entries.map((e) => [e.entry_id, e]))
  const l1 = queue.split('-')[1] ?? ''
  const required = new Set(aiReviewRequired(cfg))
  const out: RowView[] = []
  for (const name of readdirSync(qdir).filter((f) => f.endsWith('.csv')).sort()) {
    const file = join('review', queue, name)
    const text = readFileSync(join(dir, file), 'utf8')
    const version = fileVersion(text)
    const sidecar = readJson<Sidecar>(join(dir, file.replace(/\.csv$/, '.json')))
    const proposals = new Map(sidecar.items.map((i) => [i.key, i.proposed]))
    for (const row of csvRecords(text).rows) {
      const key = (row['key'] ?? '').trim()
      if (!proposals.has(key)) continue
      const reports = row['reopened'] ?? ''
      const content = rowContent(queue, proposals.get(key), reports)
      const state = aiState(store, cfg, queue, key, content)
      const verdicts = allVerdicts(store, cfg, queue, key, content)
      const requiredObjections = verdicts.filter((v) => required.has(v.reviewer)).flatMap((v) => v.objections)
      const e = byId.get(key)
      const otherSenses =
        kind === 'translation' && e
          ? draft.entries
              .filter((o) => o.entry_id !== key && live.has(o.entry_id) && norm(o.headword) === norm(e.headword) && o.pos === e.pos)
              .map((o) => ({ key: o.entry_id, translation: o.l1[l1]?.translation ?? '', sense_en: o.sense_en }))
          : []
      const verdict = (row['verdict'] ?? '').trim()
      out.push({
        queue, file, version, key, kind,
        cells: Object.fromEntries(FIELDS[kind].map((f) => [f, row[f] ?? ''])),
        fields: [...FIELDS[kind]],
        context: Object.fromEntries(['headword', 'pos', 'sense_en', 'level', 'example', 'band', 'words'].filter((c) => c in row).map((c) => [c, row[c] ?? ''])),
        otherSenses,
        reports,
        ai: state.status,
        severity: requiredObjections.some((o) => o.severity === 'major') ? 'major' : requiredObjections.length > 0 ? 'minor' : null,
        objections: verdicts.flatMap((v) => v.objections.map((o) => ({ reviewer: v.reviewer, model: v.model, ...o }))),
        decided: verdict === '' ? null : { verdict, note: row['note'] ?? '' },
      })
    }
  }
  return out
}

const rank = (r: RowView) => (r.reports !== '' ? 0 : r.severity === 'major' ? 1 : r.severity === 'minor' ? 2 : r.ai === 'unreviewed' ? 3 : 4)

/** Rows of one queue, open ones in order: reported, then major, minor, then (when withUnflagged) the rest. */
export function listRows(dir: string, queue: string, opts: { withUnflagged: boolean }): RowView[] {
  return rowsOf(dir, queue)
    .filter((r) => opts.withUnflagged || r.reports !== '' || r.ai === 'flagged')
    .sort((a, b) => rank(a) - rank(b))
}

export function listQueues(dir: string): QueueSummary[] {
  return aiConfig(dir).queues.map((queue) => {
    const rows = rowsOf(dir, queue)
    return {
      queue,
      open: rows.length,
      flagged: rows.filter((r) => r.ai === 'flagged').length,
      reported: rows.filter((r) => r.reports !== '').length,
      decided: rows.filter((r) => r.decided !== null).length,
    }
  })
}
