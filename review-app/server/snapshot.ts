import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { FIELDS, queueKind } from '@wordado/pipeline/aiReview/prompts'
import { readConfig } from '@wordado/pipeline/config'
import { queueSpecs } from '@wordado/pipeline/queues'
import { languageOf } from '../shared/hosted'
import { CURRENT_KEY, snapshotFileKey, snapshotIndexKey, type SnapshotFile, type SnapshotIndex, type SnapshotQueue } from '../shared/snapshot'
import { allRows, fileVersion } from './model'
import type { RowView } from './types'

/** <7-char sha>-<yyyymmddThhmmZ> */
export function snapshotId(commit: string, built: string): string {
  const d = new Date(built)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${commit.slice(0, 7)}-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`
}

function write(out: string, key: string, value: unknown): void {
  const path = join(out, key)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

/**
 * The rows of every open review file the hosted app serves (translation-<l1>, title-<l1>, level), as the local app
 * shows them, under snapshots/<id>/, then current.json pointing at it (spec 2026-10-05 §4).
 */
export function buildSnapshot(dir: string, out: string, meta: { commit: string; built: string }): SnapshotIndex {
  const id = snapshotId(meta.commit, meta.built)
  const specs = queueSpecs(readConfig(dir).l1s)
  const reviewDir = join(dir, 'review')
  const names = existsSync(reviewDir) ? readdirSync(reviewDir).sort() : []
  const queues: SnapshotQueue[] = []
  for (const queue of names) {
    const language = languageOf(queue)
    const spec = specs.get(queue)
    if (!language || !spec || !queueKind(queue) || !FIELDS[queueKind(queue)!]) continue
    const byFile = new Map<string, RowView[]>()
    for (const r of allRows(dir, queue)) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r])
    if (byFile.size === 0) continue
    const files = [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, rows]) => {
      const body: SnapshotFile = { file, version: fileVersion(readFileSync(join(dir, file), 'utf8')), rows }
      write(out, snapshotFileKey(id, file), body)
      return { file, rows: rows.length, flagged: rows.filter((r) => r.ai === 'flagged').length, reported: rows.filter((r) => r.reports !== '').length }
    })
    queues.push({ queue, language, columns: [...spec.columns], verdicts: [...spec.verdicts], files })
  }
  const index: SnapshotIndex = { id, built: meta.built, commit: meta.commit, queues }
  write(out, snapshotIndexKey(id), index)
  write(out, CURRENT_KEY, { id, built: meta.built, commit: meta.commit })
  return index
}
