import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { readConfig } from '@wordado/pipeline/config'
import { importQueues, queueSpecs } from '@wordado/pipeline/queues'
import { ACTIONS, applyDecisions } from '../shared/apply'
import { fileVersion } from './model'
import type { DecisionRequest, DecisionResult, ImportResult } from './types'

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
  const out = applyDecisions(text, spec, [{ key: req.key, action: req.action, cells: req.cells, note: req.note }])
  if (out.applied.length === 0) return { ok: false, reason: 'gone', message: `${req.key} is no longer in ${req.file}` }
  writeFileSync(path, out.text)
  return { ok: true, version: fileVersion(out.text) }
}

export function runImport(dir: string, by: string, now: string): ImportResult {
  return importQueues(dir, queueSpecs(readConfig(dir).l1s), { by, now })
}
