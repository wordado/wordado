import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { reviewFixture } from '../../server/fixture'
import { buildSnapshot } from '../../server/snapshot'
import { CURRENT_KEY, type SnapshotIndex } from '../../shared/snapshot'
import type { Env } from '../bindings'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
}

/** The local app's fixture as a snapshot in R2, as review-snapshot.yml would leave it. */
export async function putSnapshot(env: Env, commit = 'abcdef1234', built = '2026-10-05T10:00:00Z'): Promise<{ index: SnapshotIndex; content: string; out: string }> {
  const content = await reviewFixture()
  const out = mkdtempSync(join(tmpdir(), 'snap-'))
  const index = buildSnapshot(content, out, { commit, built })
  for (const path of walk(out).filter((p) => !p.endsWith(CURRENT_KEY))) await env.SNAPSHOTS.put(relative(out, path), readFileSync(path, 'utf8'))
  await env.SNAPSHOTS.put(CURRENT_KEY, readFileSync(join(out, CURRENT_KEY), 'utf8'))
  return { index, content, out }
}
