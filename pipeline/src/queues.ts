import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { canonicalJson, CEFR_LEVELS } from '@wordado/core'
import { sha256Hex } from './checksum'
import { contentPaths } from './content'
import { csvRecords, formatCsv } from './csv'
import { Decisions, foldField, QUEUES, type DecisionEvent, type Verdict } from './decisions'
import type { Draft } from './draft'
import { readJson, writeJson } from './files'

export interface QueueItem {
  readonly key: string
  /** The value the reviewer judges; an ok binds to it (Decision 5). */
  readonly proposed: unknown
  /** Read-only columns that help the reviewer decide. */
  readonly context: Readonly<Record<string, string>>
}

export interface QueueSpec {
  readonly name: string
  /** Columns the reviewer may edit. */
  readonly columns: readonly string[]
  readonly context: readonly string[]
  readonly verdicts: readonly Verdict[]
  toCells(value: unknown): Record<string, string>
  /** Throws an Error naming the bad cell. */
  fromCells(cells: Readonly<Record<string, string>>): unknown
}

interface Sidecar {
  readonly queue: string
  readonly items: readonly { readonly key: string; readonly proposed: unknown }[]
}

export const LIST_SEPARATOR = ' | '
export const splitList = (cell: string): string[] => cell.split('|').map((s) => s.trim()).filter((s) => s !== '')
const required = (cells: Readonly<Record<string, string>>, col: string): string => {
  const v = (cells[col] ?? '').trim()
  if (v === '') throw new Error(`${col} is empty`)
  return v
}

export function queueSpecs(l1s: readonly string[]): Map<string, QueueSpec> {
  const specs: QueueSpec[] = [
    {
      name: QUEUES.english,
      columns: ['ipa', 'variants', 'examples'],
      context: ['headword', 'pos', 'sense_en', 'level', 'reopened'],
      verdicts: ['ok', 'drop'],
      toCells: (v) => {
        const e = v as { ipa: string; variants: string[]; examples: string[] }
        return { ipa: e.ipa, variants: e.variants.join(LIST_SEPARATOR), examples: e.examples.join(LIST_SEPARATOR) }
      },
      fromCells: (c) => {
        const examples = splitList(c['examples'] ?? '')
        if (examples.length === 0) throw new Error('examples is empty')
        return { ipa: required(c, 'ipa'), variants: splitList(c['variants'] ?? ''), examples }
      },
    },
    {
      name: QUEUES.level,
      columns: ['level'],
      context: ['headword', 'pos', 'sense_en', 'band', 'reopened'],
      verdicts: ['ok'],
      toCells: (v) => ({ level: String(v) }),
      fromCells: (c) => {
        const level = required(c, 'level').toUpperCase()
        if (!(CEFR_LEVELS as readonly string[]).includes(level)) throw new Error(`level must be one of ${CEFR_LEVELS.join(', ')}`)
        return level
      },
    },
    {
      name: QUEUES.audio,
      columns: [],
      context: ['headword', 'accent', 'listen', 'reason'],
      verdicts: ['ok', 'redo'],
      toCells: () => ({}),
      fromCells: () => null,
    },
  ]
  for (const l1 of l1s) {
    specs.push({
      name: QUEUES.translation(l1),
      columns: ['translation', 'alternates', 'sense'],
      context: ['headword', 'pos', 'sense_en', 'level', 'example', 'reopened'],
      verdicts: ['ok', 'drop'],
      toCells: (v) => {
        const t = v as { translation: string; alternates: string[]; sense: string }
        return { translation: t.translation, alternates: t.alternates.join(LIST_SEPARATOR), sense: t.sense }
      },
      fromCells: (c) => ({ translation: required(c, 'translation'), alternates: splitList(c['alternates'] ?? ''), sense: (c['sense'] ?? '').trim() }),
    })
    specs.push({
      name: QUEUES.title(l1),
      columns: ['title_en', 'title_l1'],
      context: ['level', 'words', 'reopened'],
      verdicts: ['ok'],
      toCells: (v) => {
        const t = v as { en: string; l1: string }
        return { title_en: t.en, title_l1: t.l1 }
      },
      fromCells: (c) => ({ en: required(c, 'title_en'), l1: required(c, 'title_l1') }),
    })
  }
  return new Map(specs.map((s) => [s.name, s]))
}

/** The banding spot-check's deterministic 1-in-20 sample (Decision 6). */
export function levelSampled(entryId: string): boolean {
  return Number.parseInt(sha256Hex(new TextEncoder().encode(entryId)).slice(0, 8), 16) % 20 === 0
}

/** Every item still waiting for a reviewer, per queue, from the draft and the decisions so far. Audio's items come from `audioQueueItems`. */
export function pendingItems(draft: Draft, decisions: Decisions, l1s: readonly string[]): Map<string, QueueItem[]> {
  const out = new Map<string, QueueItem[]>([[QUEUES.english, []], [QUEUES.level, []]])
  for (const l1 of l1s) {
    out.set(QUEUES.translation(l1), [])
    out.set(QUEUES.title(l1), [])
  }
  const live = new Set(draft.live)
  const push = <T>(queue: string, key: string, proposal: T, context: Record<string, string>) => {
    const events = decisions.for(queue, key)
    const state = foldField(proposal, events)
    if (state.reviewed || state.dropped) return
    const reopen = [...events].reverse().find((e) => e.verdict === 'reopen')
    out.get(queue)!.push({ key, proposed: state.value, context: { ...context, reopened: state.reopened ? (reopen?.note ?? 'reopened') : '' } })
  }
  for (const e of draft.entries) {
    if (!live.has(e.entry_id)) continue
    const base = { headword: e.headword, pos: e.pos, sense_en: e.sense_en, level: e.level }
    push(QUEUES.english, e.entry_id, e.english, base)
    for (const l1 of l1s) push(QUEUES.translation(l1), e.entry_id, e.l1[l1], { ...base, example: e.english.examples[0] ?? '' })
  }
  for (const e of draft.entries) {
    if (!live.has(e.entry_id) || !(e.level_flagged || levelSampled(e.entry_id))) continue
    push(QUEUES.level, e.entry_id, e.level_proposal, { headword: e.headword, pos: e.pos, sense_en: e.sense_en, band: e.band })
  }
  const byId = new Map(draft.entries.map((e) => [e.entry_id, e]))
  for (const u of draft.units) {
    const words = u.entry_ids.filter((id) => live.has(id))
    if (words.length === 0) continue
    for (const l1 of l1s) {
      const title = u.titles[l1]
      if (title) push(QUEUES.title(l1), u.unit_id, title, { level: u.level, words: words.map((id) => byId.get(id)?.headword ?? id).join(', ') })
    }
  }
  return out
}

function header(spec: QueueSpec): string[] {
  return ['key', 'verdict', ...spec.columns, ...spec.context, 'note']
}

function openFiles(dir: string, queue: string): string[] {
  const qdir = contentPaths(dir).queueDir(queue)
  if (!existsSync(qdir)) return []
  return readdirSync(qdir).filter((f) => f.endsWith('.csv')).sort().map((f) => join(qdir, f))
}

const sidecarOf = (csv: string) => csv.replace(/\.csv$/, '.json')

/** Writes pending items not already in an open file, `batchSize` rows per file. Returns the files written. */
export function exportQueues(
  dir: string,
  items: ReadonlyMap<string, readonly QueueItem[]>,
  specs: ReadonlyMap<string, QueueSpec>,
  opts: { stamp: string; batchSize?: number },
): string[] {
  const batchSize = opts.batchSize ?? 200
  const written: string[] = []
  for (const [queue, all] of [...items].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const spec = specs.get(queue)
    if (!spec) throw new Error(`no queue ${queue}`)
    const open = new Set(openFiles(dir, queue).flatMap((f) => readJson<Sidecar>(sidecarOf(f)).items.map((i) => i.key)))
    const fresh = all.filter((i) => !open.has(i.key))
    const qdir = contentPaths(dir).queueDir(queue)
    let n = 0
    for (let i = 0; i < fresh.length; i += batchSize) {
      const batch = fresh.slice(i, i + batchSize)
      let file: string
      do {
        n += 1
        file = join(qdir, `${opts.stamp}-${String(n).padStart(2, '0')}.csv`)
      } while (existsSync(file))
      const cols = header(spec)
      const rows = batch.map((item) => {
        const cells: Record<string, string> = { key: item.key, verdict: '', note: '', ...item.context, ...spec.toCells(item.proposed) }
        return cols.map((c) => cells[c] ?? '')
      })
      mkdirSync(qdir, { recursive: true })
      writeFileSync(file, formatCsv([cols, ...rows]))
      writeJson(sidecarOf(file), { queue, items: batch.map((b) => ({ key: b.key, proposed: b.proposed })) } satisfies Sidecar)
      written.push(relative(dir, file))
    }
  }
  return written
}

/** Applies every row with a verdict. Rows without one stay, with their edits; a file with none left is removed. */
export function importQueues(dir: string, specs: ReadonlyMap<string, QueueSpec>, opts: { by: string; now: string }): { applied: number; pending: number; errors: string[] } {
  if (opts.by.trim() === '') throw new Error('name the reviewer with --by')
  const decisions = Decisions.read(dir)
  const errors: string[] = []
  let applied = 0
  let pending = 0
  for (const spec of specs.values()) {
    for (const file of openFiles(dir, spec.name)) {
      const rel = relative(dir, file)
      const sidecar = readJson<Sidecar>(sidecarOf(file))
      const proposals = new Map(sidecar.items.map((i) => [i.key, i.proposed]))
      const { header: cols, rows } = csvRecords(readFileSync(file, 'utf8'))
      const events: DecisionEvent[] = []
      const keep: Record<string, string>[] = []
      for (const row of rows) {
        const key = (row['key'] ?? '').trim()
        const verdict = (row['verdict'] ?? '').trim().toLowerCase()
        if (!proposals.has(key)) {
          errors.push(`${rel} ${key}: not an item of this file`)
          continue
        }
        if (verdict === '') {
          keep.push(row)
          continue
        }
        if (!(spec.verdicts as readonly string[]).includes(verdict)) {
          errors.push(`${rel} ${key}: verdict "${row['verdict']}" is not one of ${spec.verdicts.join(', ')}`)
          keep.push(row)
          continue
        }
        const proposed = proposals.get(key)
        const note = (row['note'] ?? '').trim()
        const base = { key, at: opts.now, by: opts.by.trim(), proposed, ...(note ? { note } : {}) }
        if (verdict === 'ok' && spec.columns.length > 0) {
          let value: unknown
          try {
            value = spec.fromCells(row)
          } catch (err) {
            errors.push(`${rel} ${key}: ${err instanceof Error ? err.message : String(err)}`)
            keep.push(row)
            continue
          }
          events.push(canonicalJson(value) === canonicalJson(proposed) ? { ...base, verdict: 'ok' } : { ...base, verdict: 'fix', value })
        } else events.push({ ...base, verdict: verdict as Verdict })
      }
      decisions.append(spec.name, events)
      applied += events.length
      pending += keep.length
      if (keep.length === 0) {
        rmSync(file)
        rmSync(sidecarOf(file))
      } else {
        writeFileSync(file, formatCsv([cols, ...keep.map((r) => cols.map((c) => r[c] ?? ''))]))
        const kept = new Set(keep.map((r) => (r['key'] ?? '').trim()))
        writeJson(sidecarOf(file), { queue: spec.name, items: sidecar.items.filter((i) => kept.has(i.key)) } satisfies Sidecar)
      }
    }
  }
  return { applied, pending, errors }
}
