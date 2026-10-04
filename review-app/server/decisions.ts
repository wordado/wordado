import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { readConfig } from '@wordado/pipeline/config'
import { csvRecords, formatCsv } from '@wordado/pipeline/csv'
import { importQueues, queueSpecs } from '@wordado/pipeline/queues'
import { fileVersion } from './model'
import type { Action, DecisionRequest, DecisionResult, ImportResult } from './types'

const ACTIONS: readonly Action[] = ['accept', 'keep', 'edit', 'drop']

export function saveDecision(dir: string, req: DecisionRequest): DecisionResult {
  const spec = queueSpecs(readConfig(dir).l1s).get(req.queue)
  if (!spec) return { ok: false, reason: 'invalid', message: `no queue ${req.queue}` }
  if (!ACTIONS.includes(req.action)) return { ok: false, reason: 'invalid', message: `${String(req.action)} is not accept, keep, edit or drop` }
  const folder = resolve(dir, 'review', req.queue)
  const path = resolve(dir, req.file)
  const rel = relative(folder, path)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep) || !path.endsWith('.csv')) {
    return { ok: false, reason: 'invalid', message: `${req.file} is not a file of ${req.queue}` }
  }
  if (!existsSync(path)) return { ok: false, reason: 'gone', message: `${req.file} is gone (imported, or a new draft replaced it)` }
  if (req.action === 'drop' && !spec.verdicts.includes('drop')) return { ok: false, reason: 'invalid', message: `${req.queue} has no drop` }
  const text = readFileSync(path, 'utf8')
  if (fileVersion(text) !== req.version) return { ok: false, reason: 'changed', message: `${req.file} changed since it was loaded` }
  const { header, rows } = csvRecords(text)
  const row = rows.find((r) => (r['key'] ?? '').trim() === req.key)
  if (!row) return { ok: false, reason: 'gone', message: `${req.key} is no longer in ${req.file}` }
  for (const col of spec.columns) if (req.cells && col in req.cells) row[col] = req.cells[col] ?? ''
  row['verdict'] = req.action === 'drop' ? 'drop' : 'ok'
  // An empty note from the UI means "no note given", not "clear the existing one".
  if (req.note !== undefined && req.note !== '') row['note'] = req.note
  const next = formatCsv([header, ...rows.map((r) => header.map((c) => r[c] ?? ''))])
  writeFileSync(path, next)
  return { ok: true, version: fileVersion(next) }
}

export function runImport(dir: string, by: string, now: string): ImportResult {
  return importQueues(dir, queueSpecs(readConfig(dir).l1s), { by, now })
}
