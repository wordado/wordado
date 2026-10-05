import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rowContent } from '@wordado/pipeline/aiReview/store'
import { describe, expect, it } from 'vitest'
import { CURRENT_KEY, snapshotFileKey, snapshotIndexKey, type SnapshotFile, type SnapshotIndex } from '../shared/snapshot'
import { reviewFixture } from './fixture'
import { listRows } from './model'
import { buildSnapshot } from './snapshot'

describe('buildSnapshot', () => {
  it('writes an index, one JSON per review file and current.json last', async () => {
    const dir = await reviewFixture()
    const out = mkdtempSync(join(tmpdir(), 'snap-'))
    const index = buildSnapshot(dir, out, { commit: '3f2a91c0ffee', built: '2026-10-05T10:12:30Z' })
    expect(index.id).toBe('3f2a91c-20261005T1012Z')
    expect(JSON.parse(readFileSync(join(out, CURRENT_KEY), 'utf8'))).toEqual({ id: index.id, built: '2026-10-05T10:12:30Z', commit: '3f2a91c0ffee' })
    const onDisk = JSON.parse(readFileSync(join(out, snapshotIndexKey(index.id)), 'utf8')) as SnapshotIndex
    expect(onDisk).toEqual(index)
    const queues = index.queues.map((q) => q.queue)
    expect(queues).toContain('translation-bg')
    expect(queues).toContain('level')
    expect(queues).not.toContain('english')
    expect(queues).not.toContain('audio')
    const bg = index.queues.find((q) => q.queue === 'translation-bg')!
    expect(bg.language).toBe('bg')
    expect(bg.columns).toEqual(['translation', 'alternates', 'sense'])
    expect(bg.verdicts).toContain('drop')
    expect(index.queues.find((q) => q.queue === 'level')!.language).toBe('en')
    for (const f of bg.files) expect(existsSync(join(out, snapshotFileKey(index.id, f.file)))).toBe(true)
  })

  it('holds every row as the local app shows it, with its row hash', async () => {
    const dir = await reviewFixture()
    const out = mkdtempSync(join(tmpdir(), 'snap-'))
    const index = buildSnapshot(dir, out, { commit: 'abcdef1', built: '2026-10-05T00:00:00Z' })
    const bg = index.queues.find((q) => q.queue === 'translation-bg')!
    const rows = bg.files.flatMap((f) => (JSON.parse(readFileSync(join(out, snapshotFileKey(index.id, f.file)), 'utf8')) as SnapshotFile).rows)
    expect(rows.length).toBe(bg.files.reduce((n, f) => n + f.rows, 0))
    expect(bg.files.reduce((n, f) => n + f.flagged, 0)).toBe(rows.filter((r) => r.ai === 'flagged').length)
    const flaggedLocal = listRows(dir, 'translation-bg', { withUnflagged: false })
    for (const r of flaggedLocal) expect(rows.find((x) => x.key === r.key)).toEqual(r)
    const sample = rows[0]!
    expect(sample.rowHash).toMatch(/^[0-9a-f]{64}$/)
    expect(sample.rowHash).not.toBe(rowContent('translation-bg', 'something else', ''))
  })
})
