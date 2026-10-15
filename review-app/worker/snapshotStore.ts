import { CURRENT_KEY, snapshotDigestKey, snapshotFileKey, snapshotIndexKey, type QueueDigest, type SnapshotFile, type SnapshotIndex, type SnapshotPointer, type SnapshotQueue } from '../shared/snapshot'
import type { Deps } from './app'

export interface Snapshot {
  readonly index: SnapshotIndex
  queue(name: string): SnapshotQueue | null
  file(path: string): Promise<SnapshotFile | null>
  /** The queue's digest; null for a snapshot built before digests were (#279). */
  digest(queue: string): Promise<QueueDigest | null>
}

let head: { at: number; index: SnapshotIndex } | null = null
const files = new Map<string, SnapshotFile>()
const MAX_FILES = 64
/** By key, the read itself, so the assignments of one list share it; a miss is kept too, so a snapshot without
 * digests costs one read per queue and not one per list. */
const digests = new Map<string, Promise<QueueDigest | null>>()

export function resetSnapshotCache(): void {
  head = null
  files.clear()
  digests.clear()
}

/** The snapshot current.json names (spec §4.3), or null when there is none yet or it is incomplete. Cached 30 s. */
export async function currentSnapshot(deps: Deps): Promise<Snapshot | null> {
  const now = deps.now().getTime()
  if (!head || now - head.at > 30_000) {
    const pointer = await deps.env.SNAPSHOTS.get(CURRENT_KEY)
    if (!pointer) return null
    const { id } = JSON.parse(await pointer.text()) as SnapshotPointer
    if (head?.index.id !== id) {
      const index = await deps.env.SNAPSHOTS.get(snapshotIndexKey(id))
      if (!index) return null
      head = { at: now, index: JSON.parse(await index.text()) as SnapshotIndex }
    } else head = { at: now, index: head.index }
  }
  const index = head.index
  return {
    index,
    queue: (name) => index.queues.find((q) => q.queue === name) ?? null,
    file: async (path) => {
      const key = snapshotFileKey(index.id, path)
      const hit = files.get(key)
      if (hit) return hit
      const obj = await deps.env.SNAPSHOTS.get(key)
      if (!obj) return null
      const body = JSON.parse(await obj.text()) as SnapshotFile
      if (files.size >= MAX_FILES) files.delete(files.keys().next().value!)
      files.set(key, body)
      return body
    },
    digest: (queue) => {
      const key = snapshotDigestKey(index.id, queue)
      const hit = digests.get(key)
      if (hit) return hit
      const read = deps.env.SNAPSHOTS.get(key).then(async (obj) => (obj ? (JSON.parse(await obj.text()) as QueueDigest) : null))
      if (digests.size >= MAX_FILES) digests.delete(digests.keys().next().value!)
      // A read that failed is not kept: the next request tries again.
      digests.set(key, read.catch((e: unknown) => (digests.delete(key), Promise.reject(e))))
      return digests.get(key)!
    },
  }
}
