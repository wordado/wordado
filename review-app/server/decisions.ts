import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { readConfig } from '@wordado/pipeline/config'
import { csvRecords, formatCsv } from '@wordado/pipeline/csv'
import { importQueues, queueSpecs } from '@wordado/pipeline/queues'
import { fileVersion } from './model'
import type { DecisionRequest, DecisionResult, ImportResult } from './types'

export function saveDecision(dir: string, req: DecisionRequest): DecisionResult {
  const rel = normalize(req.file)
  if (!rel.startsWith(join('review', req.queue) + '/') || !rel.endsWith('.csv')) return { ok: false, reason: 'invalid', message: `${req.file} is not a file of ${req.queue}` }
  const path = join(dir, rel)
  if (!existsSync(path)) return { ok: false, reason: 'gone', message: `${req.file} is gone (imported, or a new draft replaced it)` }
  const spec = queueSpecs(readConfig(dir).l1s).get(req.queue)
  if (!spec) return { ok: false, reason: 'invalid', message: `no queue ${req.queue}` }
  if (req.action === 'drop' && !spec.verdicts.includes('drop')) return { ok: false, reason: 'invalid', message: `${req.queue} has no drop` }
  const text = readFileSync(path, 'utf8')
  if (fileVersion(text) !== req.version) return { ok: false, reason: 'changed', message: `${req.file} changed since it was loaded` }
  const { header, rows } = csvRecords(text)
  const row = rows.find((r) => (r['key'] ?? '').trim() === req.key)
  if (!row) return { ok: false, reason: 'gone', message: `${req.key} is no longer in ${req.file}` }
  for (const col of spec.columns) if (req.cells && col in req.cells) row[col] = req.cells[col] ?? ''
  row['verdict'] = req.action === 'drop' ? 'drop' : 'ok'
  row['note'] = req.note ?? row['note'] ?? ''
  const next = formatCsv([header, ...rows.map((r) => header.map((c) => r[c] ?? ''))])
  writeFileSync(path, next)
  return { ok: true, version: fileVersion(next) }
}

export function runImport(dir: string, by: string, now: string): ImportResult {
  return importQueues(dir, queueSpecs(readConfig(dir).l1s), { by, now })
}
