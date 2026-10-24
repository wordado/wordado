import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { FIELDS, queueKind } from '@wordado/pipeline/aiReview/prompts'
import { readConfig } from '@wordado/pipeline/config'
import { profileOf } from '@wordado/pipeline/profiles'
import { queueSpecs } from '@wordado/pipeline/queues'
import { TARGETS } from '@wordado/core'
import { hostedQueue, languageOf } from '../shared/hosted'
import { CURRENT_KEY, digestRows, snapshotDigestKey, snapshotFileKey, snapshotIndexKey, type QueueDigest, type SnapshotFile, type SnapshotIndex, type SnapshotQueue } from '../shared/snapshot'
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
 * The rows of every open review file the hosted app serves (translation-<l1>, title-<l1>, level, a target's
 * grammar), as the local app shows them, under snapshots/<id>/, with a digest of each queue's rows, then
 * current.json pointing at it (spec 2026-10-05 §4). Another target's corpus, in its own directory (`de/`, spec
 * §5.5), is read too: its queues and files keep the prefix (`de/translation-bg`, `de/review/…`) (#317).
 */
export function buildSnapshot(dir: string, out: string, meta: { commit: string; built: string }): SnapshotIndex {
  const id = snapshotId(meta.commit, meta.built)
  const queues: SnapshotQueue[] = []
  const corpora = TARGETS.filter((t) => t === 'en' || existsSync(join(dir, t, 'pipeline.json')))
  for (const target of corpora) {
    const root = target === 'en' ? dir : join(dir, target)
    const prefix = target === 'en' ? '' : `${target}/`
    const config = readConfig(root)
    const specs = queueSpecs(config.l1s, profileOf(config))
    const reviewDir = join(root, 'review')
    const names = existsSync(reviewDir) ? readdirSync(reviewDir).sort() : []
    for (const name of names) {
      const queue = hostedQueue(target, name)
      const language = languageOf(queue)
      const spec = specs.get(name)
      if (!language || !spec || !queueKind(name) || !FIELDS[queueKind(name)!]) continue
      const byFile = new Map<string, RowView[]>()
      // The row hash stays the pipeline's own, of the corpus's queue name, as submit checks it.
      for (const r of allRows(root, name)) byFile.set(prefix + r.file, [...(byFile.get(prefix + r.file) ?? []), { ...r, queue, file: prefix + r.file }])
      if (byFile.size === 0) continue
      const files = [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, rows]) => {
        const body: SnapshotFile = { file, version: fileVersion(readFileSync(join(dir, file), 'utf8')), rows }
        write(out, snapshotFileKey(id, file), body)
        return { file, rows: rows.length, flagged: rows.filter((r) => r.ai === 'flagged').length, reported: rows.filter((r) => r.reports !== '').length }
      })
      const digest: QueueDigest = { files: Object.fromEntries(files.map(({ file }) => [file, digestRows(byFile.get(file)!)])) }
      write(out, snapshotDigestKey(id, queue), digest)
      queues.push({ queue, language, columns: [...spec.columns], verdicts: [...spec.verdicts], files })
    }
  }
  const index: SnapshotIndex = { id, built: meta.built, commit: meta.commit, queues }
  write(out, snapshotIndexKey(id), index)
  write(out, CURRENT_KEY, { id, built: meta.built, commit: meta.commit })
  return index
}
