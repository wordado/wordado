import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rowContent } from '@wordado/pipeline/aiReview/store'
import { describe, expect, it } from 'vitest'
import { CURRENT_KEY, snapshotDigestKey, snapshotFileKey, snapshotIndexKey, type QueueDigest, type SnapshotFile, type SnapshotIndex } from '../shared/snapshot'
import { germanFixture, reviewFixture } from './fixture'
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

  it('writes a digest per queue: every row of every file, its hash and whether a flagged-only assignment holds it', async () => {
    const dir = await reviewFixture()
    const out = mkdtempSync(join(tmpdir(), 'snap-'))
    const index = buildSnapshot(dir, out, { commit: 'abcdef1', built: '2026-10-05T00:00:00Z' })
    const scopes = new Set<boolean>()
    for (const q of index.queues) {
      const digest = JSON.parse(readFileSync(join(out, snapshotDigestKey(index.id, q.queue)), 'utf8')) as QueueDigest
      expect(Object.keys(digest.files)).toEqual(q.files.map((f) => f.file))
      for (const f of q.files) {
        const rows = (JSON.parse(readFileSync(join(out, snapshotFileKey(index.id, f.file)), 'utf8')) as SnapshotFile).rows
        expect(digest.files[f.file]).toEqual(rows.map((r) => [r.key, r.rowHash, r.ai === 'flagged' || r.reports !== '' || r.stale]))
        for (const [, , flagged] of digest.files[f.file]!) scopes.add(flagged)
      }
    }
    expect([...scopes].sort()).toEqual([false, true])
  })

  it('serves a second target’s queues under its prefix, apart from English’s, with the rows its own corpus gives', async () => {
    const dir = await germanFixture()
    const out = mkdtempSync(join(tmpdir(), 'snap-'))
    const index = buildSnapshot(dir, out, { commit: 'abcdef1', built: '2026-10-05T00:00:00Z' })
    const queues = index.queues.map((q) => [q.queue, q.language])
    expect(queues).toEqual(expect.arrayContaining([['translation-bg', 'bg'], ['level', 'en'], ['de/translation-bg', 'bg'], ['de/translation-en', 'en'], ['de/level', 'de'], ['de/grammar', 'de']]))
    expect(queues.map(([q]) => q)).not.toContain('de/german')
    const grammar = index.queues.find((q) => q.queue === 'de/grammar')!
    expect(grammar.columns).toEqual(['gender', 'plural', 'separable', 'irregular', 'auxiliary'])
    expect(grammar.verdicts).not.toContain('drop')
    const de = index.queues.find((q) => q.queue === 'de/translation-bg')!
    expect(de.files.length).toBeGreaterThan(0)
    for (const f of de.files) {
      expect(f.file).toMatch(/^de\/review\/translation-bg\/[^/]+\.csv$/)
      const body = JSON.parse(readFileSync(join(out, snapshotFileKey(index.id, f.file)), 'utf8')) as SnapshotFile
      expect(body.file).toBe(f.file)
      // A row is the German corpus's row as the local app shows it there, under the hosted queue and path.
      const local = listRows(join(dir, 'de'), 'translation-bg', { withUnflagged: true })
      for (const r of body.rows) expect(r).toEqual({ ...local.find((x) => x.key === r.key)!, queue: 'de/translation-bg', file: f.file })
      expect(body.rows.some((r) => r.ai === 'flagged')).toBe(true)
      const digest = JSON.parse(readFileSync(join(out, snapshotDigestKey(index.id, 'de/translation-bg')), 'utf8')) as QueueDigest
      expect(digest.files[f.file]).toEqual(body.rows.map((r) => [r.key, r.rowHash, r.ai === 'flagged' || r.reports !== '' || r.stale]))
    }
    // English's rows are where they were.
    const bg = index.queues.find((q) => q.queue === 'translation-bg')!
    for (const f of bg.files) expect(f.file).toMatch(/^review\/translation-bg\//)
  })
})
