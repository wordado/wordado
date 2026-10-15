import type { RowView } from '../server/types'
import type { Language } from './hosted'

export const CURRENT_KEY = 'current.json'

export interface SnapshotPointer {
  readonly id: string
  readonly built: string
  readonly commit: string
}
export interface SnapshotFileInfo {
  readonly file: string
  readonly rows: number
  readonly flagged: number
  readonly reported: number
}
export interface SnapshotQueue {
  readonly queue: string
  readonly language: Language
  readonly columns: readonly string[]
  readonly verdicts: readonly string[]
  readonly files: readonly SnapshotFileInfo[]
}
export interface SnapshotIndex extends SnapshotPointer {
  readonly queues: readonly SnapshotQueue[]
}
export interface SnapshotFile {
  readonly file: string
  readonly version: string
  readonly rows: readonly RowView[]
}
/** A row in brief: its key, its row hash, and whether a flagged-only assignment holds it (inFlaggedScope). */
export type DigestRow = readonly [key: string, rowHash: string, flagged: boolean]
/**
 * A queue's rows in brief, file by file in each file's order: what a list of assignments needs to count progress,
 * so that it reads one small object per queue instead of parsing every file (#279).
 */
export interface QueueDigest {
  readonly files: Readonly<Record<string, readonly DigestRow[]>>
}

/**
 * What a flagged-only assignment holds: the rows the AI review flags, the rows learners reported, and the stale
 * rows, as the local app lists them (server/model.ts). A stale row's sheet froze a proposal a newer draft has since
 * changed, so no AI verdict can match it again: left out, it would wait in the files unseen, and `corpus status`
 * would count it as flagged while the app showed nothing to decide (level queue, 2026-10-07). Here, so that the
 * digest the snapshot is built with and the Worker's reading of the files cannot disagree.
 */
export const inFlaggedScope = (r: Pick<RowView, 'ai' | 'reports' | 'stale'>): boolean => r.ai === 'flagged' || r.reports !== '' || r.stale

export const digestRows = (rows: readonly RowView[]): DigestRow[] => rows.map((r) => [r.key, r.rowHash, inFlaggedScope(r)])

export const snapshotIndexKey = (id: string) => `snapshots/${id}/index.json`
/** review/<queue>/<stem>.csv → snapshots/<id>/<queue>/<stem>.json */
export const snapshotFileKey = (id: string, file: string) => `snapshots/${id}/${file.replace(/^review\//, '').replace(/\.csv$/, '.json')}`
/** snapshots/<id>/<queue>/digest.json, beside the queue's files: no review file is named digest.csv (their stems are dated). */
export const snapshotDigestKey = (id: string, queue: string) => `snapshots/${id}/${queue}/digest.json`
