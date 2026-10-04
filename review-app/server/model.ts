import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson, norm } from '@wordado/core'
import { aiReviewRequired, readConfig, type AiReviewConfig } from '@wordado/pipeline/config'
import { contentPaths } from '@wordado/pipeline/content'
import { csvRecords } from '@wordado/pipeline/csv'
import { Decisions } from '@wordado/pipeline/decisions'
import { readDraft, type Draft, type DraftEntry } from '@wordado/pipeline/draft'
import { readJson } from '@wordado/pipeline/files'
import { pendingItems, type QueueItem } from '@wordado/pipeline/queues'
import { FIELDS, queueKind } from '@wordado/pipeline/aiReview/prompts'
import { AiReviewStore, rowContent } from '@wordado/pipeline/aiReview/store'
import { aiState, allVerdicts } from '@wordado/pipeline/aiReview/vote'
import type { QueueSummary, RowView } from './types'

export const fileVersion = (text: string) => createHash('sha256').update(text).digest('hex')

interface Sidecar { readonly items: readonly { readonly key: string; readonly proposed: unknown }[] }

/** Everything one request needs, read once (not once per queue, and not once per row): the config, the AI-review
 * store, the draft, a headword|pos sibling lookup built from it, and the draft's current pending proposals, to spot
 * a row whose open file predates the draft (its frozen `proposed` no longer matches). */
interface Ctx {
  readonly cfg: AiReviewConfig
  readonly store: AiReviewStore
  readonly byId: ReadonlyMap<string, DraftEntry>
  readonly siblings: ReadonlyMap<string, readonly string[]>
  readonly pending: ReadonlyMap<string, readonly QueueItem[]>
}

function makeCtx(dir: string): Ctx {
  const config = readConfig(dir)
  const cfg = config.ai_review
  if (!cfg) throw new Error('pipeline.json has no ai_review block: add one (pipeline/README.md, "AI review")')
  const store = AiReviewStore.read(dir)
  const draft: Draft = readDraft(dir)
  const live = new Set(draft.live)
  const byId = new Map(draft.entries.map((e) => [e.entry_id, e]))
  const siblings = new Map<string, string[]>()
  for (const e of draft.entries) {
    if (!live.has(e.entry_id)) continue
    const k = `${norm(e.headword)}|${e.pos}`
    siblings.set(k, [...(siblings.get(k) ?? []), e.entry_id])
  }
  const pending = pendingItems(draft, Decisions.read(dir), config.l1s)
  return { cfg, store, byId, siblings, pending }
}

/** Every row of every open file of one queue, as the app shows it. */
function rowsOf(dir: string, queue: string, ctx: Ctx, opts: { withOtherSenses: boolean }): RowView[] {
  const kind = queueKind(queue)
  if (!kind) return []
  const qdir = contentPaths(dir).queueDir(queue)
  if (!existsSync(qdir)) return []
  const l1 = queue.split('-')[1] ?? ''
  const required = new Set(aiReviewRequired(ctx.cfg))
  const currentProposed = new Map((ctx.pending.get(queue) ?? []).map((i) => [i.key, i.proposed]))
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
      const proposed = proposals.get(key)
      const content = rowContent(queue, proposed, reports)
      const state = aiState(ctx.store, ctx.cfg, queue, key, content)
      const verdicts = allVerdicts(ctx.store, ctx.cfg, queue, key, content)
      const requiredObjections = verdicts.filter((v) => required.has(v.reviewer)).flatMap((v) => v.objections)
      const e = ctx.byId.get(key)
      const otherSenses =
        opts.withOtherSenses && kind === 'translation' && e
          ? (ctx.siblings.get(`${norm(e.headword)}|${e.pos}`) ?? [])
              .filter((id) => id !== key)
              .map((id) => ({ key: id, translation: ctx.byId.get(id)?.l1[l1]?.translation ?? '', sense_en: ctx.byId.get(id)?.sense_en ?? '' }))
          : []
      const verdict = (row['verdict'] ?? '').trim()
      // A row whose frozen proposal (the sidecar's) no longer matches the draft's current one can never get a
      // matching AI verdict: a newer draft reshaped it. Flag it instead of silently treating it as reviewed.
      const stale = currentProposed.has(key) && canonicalJson(currentProposed.get(key)) !== canonicalJson(proposed)
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
        stale,
      })
    }
  }
  return out
}

const rank = (r: RowView) => (r.reports !== '' ? 0 : r.severity === 'major' ? 1 : r.severity === 'minor' ? 2 : r.ai === 'unreviewed' ? 3 : 4)

/** Rows of one queue, open ones in order: reported, then major, minor, then (when withUnflagged) the rest. A
 * stale row (its file is older than the draft) always shows, so a reviewer notices it needs `corpus queues` again. */
export function listRows(dir: string, queue: string, opts: { withUnflagged: boolean }): RowView[] {
  const ctx = makeCtx(dir)
  return rowsOf(dir, queue, ctx, { withOtherSenses: true })
    .filter((r) => opts.withUnflagged || r.reports !== '' || r.ai === 'flagged' || r.stale)
    .sort((a, b) => rank(a) - rank(b))
}

export function listQueues(dir: string): QueueSummary[] {
  const ctx = makeCtx(dir)
  return ctx.cfg.queues.map((queue) => {
    // Counts only: skip the other-live-senses lookup rowsOf would otherwise do for every translation row.
    const rows = rowsOf(dir, queue, ctx, { withOtherSenses: false })
    return {
      queue,
      open: rows.length,
      flagged: rows.filter((r) => r.ai === 'flagged').length,
      reported: rows.filter((r) => r.reports !== '').length,
      decided: rows.filter((r) => r.decided !== null).length,
    }
  })
}
