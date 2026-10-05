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

export const snapshotIndexKey = (id: string) => `snapshots/${id}/index.json`
/** review/<queue>/<stem>.csv → snapshots/<id>/<queue>/<stem>.json */
export const snapshotFileKey = (id: string, file: string) => `snapshots/${id}/${file.replace(/^review\//, '').replace(/\.csv$/, '.json')}`
