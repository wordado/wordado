import { describe, expect, it } from 'vitest'
import type { RowView } from '../server/types'
import { digestRows, type SnapshotQueue } from '../shared/snapshot'
import type { AssignmentRow, DecisionRow, SubmissionRow } from './db'
import { assignmentHashes, assignmentRows, inScope, progress, rank, withDecisions } from './rows'
import type { Snapshot } from './snapshotStore'
import { spotCheckResult } from './spotCheck'

const row = (key: string, over: Partial<RowView> = {}): RowView => ({
  queue: 'translation-de', file: 'review/translation-de/a.csv', version: 'v', key, kind: 'translation', cells: {}, fields: [], context: {},
  otherSenses: [], reports: '', ai: 'passed', severity: null, objections: [], decided: null, stale: false, rowHash: `h-${key}`, ...over,
})
const decision = (key: string, over: Partial<DecisionRow> = {}): DecisionRow => ({
  assignment: 1, queue: 'translation-de', file: 'review/translation-de/a.csv', key, rowHash: `h-${key}`, action: 'keep', cells: {}, note: '', severity: null, decidedAt: 't', submission: null, ...over,
})

describe('withDecisions', () => {
  it('marks a decision on a changed row as changed and the row as undecided', () => {
    const [a, b] = withDecisions([row('a'), row('b')], [decision('a'), decision('b', { rowHash: 'old' })])
    expect(a!.decision).toMatchObject({ action: 'keep', changed: false })
    expect(a!.decided).toEqual({ verdict: 'ok', note: '' })
    expect(b!.decision).toMatchObject({ changed: true })
    expect(b!.decided).toBeNull()
  })
})

describe('progress', () => {
  it('counts decided, changed, submitted, merged and remaining', () => {
    const rows = [row('a'), row('b'), row('c'), row('d')]
    const subs: SubmissionRow[] = [
      { id: 7, assignment: 1, branch: 'x', pr: 1, url: null, count: 1, leftOut: 0, status: 'open', createdAt: 't' },
      { id: 8, assignment: 1, branch: 'y', pr: 2, url: null, count: 5, leftOut: 0, status: 'merged', createdAt: 't' },
    ]
    const p = progress(rows, [decision('a'), decision('b', { rowHash: 'old' }), decision('c', { submission: 7 })], subs)
    expect(p).toEqual({ inScope: 4, decided: 1, changed: 1, submitted: 1, merged: 5, remaining: 2 })
  })
})

describe('rank', () => {
  it('puts reports first, then major, minor, unreviewed', () => {
    expect([row('x', { ai: 'unreviewed' }), row('y', { severity: 'minor' }), row('z', { reports: 'r' }), row('w', { severity: 'major' })].sort((p, q) => rank(p) - rank(q)).map((r) => r.key)).toEqual(['z', 'w', 'y', 'x'])
  })

  it('ranks a stale row with the unreviewed ones, after the flagged', () => {
    expect([row('s', { stale: true }), row('m', { severity: 'minor' }), row('p')].sort((p, q) => rank(p) - rank(q)).map((r) => r.key)).toEqual(['m', 's', 'p'])
  })
})

describe('assignmentRows', () => {
  const file = 'review/level/a.csv'
  const rows = [row('passed', { file }), row('stale', { file, stale: true }), row('flagged', { file, ai: 'flagged', severity: 'major' }), row('reported', { file, reports: 'r' })]
  const snap: Snapshot = {
    index: { id: 's', built: 't', commit: 'c', queues: [] },
    queue: () => ({ queue: 'level', language: 'en', columns: [], verdicts: [], files: [{ file, rows: rows.length, flagged: 1, reported: 1 }] }),
    file: async () => ({ file, version: 'v', rows }),
    digest: async () => null,
  }
  const assignment = { id: 1, reviewer: 'r', queue: 'level', files: '*' as const, spotCheck: null, createdAt: 't', closedAt: null }

  it('gives a flagged-only assignment the flagged, reported and stale rows, worst first', async () => {
    const got = await assignmentRows(snap, { ...assignment, flaggedOnly: true })
    expect(got?.rows.map((r) => r.key)).toEqual(['reported', 'flagged', 'stale'])
    expect([...got!.keys]).toHaveLength(4)
  })

  it('gives an all-rows assignment every row in file order', async () => {
    const got = await assignmentRows(snap, { ...assignment, flaggedOnly: false })
    expect(got?.rows.map((r) => r.key)).toEqual(['passed', 'stale', 'flagged', 'reported'])
  })

  describe('a spot check', () => {
    const other = 'review/level/b.csv'
    const two: Snapshot = {
      ...snap,
      queue: () => ({ queue: 'level', language: 'en', columns: [], verdicts: [], files: [{ file, rows: rows.length, flagged: 1, reported: 1 }, { file: other, rows: 1, flagged: 0, reported: 0 }] }),
      file: async (f) => (f === file ? { file, version: 'v', rows } : { file: other, version: 'v', rows: [row('second', { file: other })] }),
    }
    const sample = [{ file: other, key: 'second' }, { file, key: 'reported' }, { file, key: 'left' }, { file, key: 'passed' }, { file: 'review/level/retired.csv', key: 'old' }]
    const spot = { ...assignment, files: [file, other, 'review/level/retired.csv'], flaggedOnly: false, spotCheck: { seed: 1, sample } }

    it('gives exactly the sampled rows the snapshot still has, in the sample’s order and not worst first', async () => {
      const got = await assignmentRows(two, spot)
      expect(got?.rows.map((r) => r.key)).toEqual(['second', 'reported', 'passed'])
      expect([...got!.keys].sort()).toEqual(['passed', 'reported', 'second'])
    })

    it('is null when a file of the sample cannot be read', async () => {
      expect(await assignmentRows({ ...two, file: async () => null }, spot)).toBeNull()
    })

    it('has in scope the rows of its sample and no other row of their files', () => {
      expect(inScope(two, spot, file, 'passed')).toBe(true)
      expect(inScope(two, spot, file, 'flagged')).toBe(false)
      expect(inScope(two, spot, other, 'passed')).toBe(false)
      expect(inScope(two, spot, 'review/level/retired.csv', 'old')).toBe(false)
      expect(inScope(two, { ...assignment, flaggedOnly: false }, file, 'anything')).toBe(true)
      expect(inScope(two, { ...assignment, flaggedOnly: false }, 'review/level/retired.csv', 'old')).toBe(false)
    })
  })
})

describe('assignmentHashes', () => {
  const a = 'review/level/a.csv'
  const b = 'review/level/b.csv'
  const retired = 'review/level/retired.csv'
  const byFile: Record<string, RowView[]> = {
    [a]: [row('passed', { file: a }), row('stale', { file: a, stale: true }), row('flagged', { file: a, ai: 'flagged', severity: 'major' }), row('reported', { file: a, reports: 'r' })],
    [b]: [row('second', { file: b }), row('minor', { file: b, ai: 'flagged', severity: 'minor' })],
  }
  const queue: SnapshotQueue = { queue: 'level', language: 'en', columns: [], verdicts: [], files: [a, b].map((f) => ({ file: f, rows: byFile[f]!.length, flagged: 0, reported: 0 })) }
  const fromFiles: Snapshot = {
    index: { id: 's', built: 't', commit: 'c', queues: [queue] },
    queue: () => queue,
    file: async (f) => (byFile[f] ? { file: f, version: 'v', rows: byFile[f] } : null),
    digest: async () => null,
  }
  const digest = { files: Object.fromEntries(Object.entries(byFile).map(([f, rows]) => [f, digestRows(rows)])) }
  const fromDigest: Snapshot = { ...fromFiles, file: async () => Promise.reject(new Error('a file was read')), digest: async () => digest }
  const base = { id: 1, reviewer: 'r', queue: 'level', createdAt: 't', closedAt: null }
  const sample = [{ file: b, key: 'second' }, { file: a, key: 'reported' }, { file: a, key: 'left' }, { file: a, key: 'flagged' }, { file: retired, key: 'old' }]
  const cases: [string, AssignmentRow][] = [
    ['a whole-file assignment', { ...base, files: [a, retired], flaggedOnly: false, spotCheck: null }],
    ['a flagged-only assignment', { ...base, files: '*', flaggedOnly: true, spotCheck: null }],
    ['a spot check', { ...base, files: [a, b, retired], flaggedOnly: false, spotCheck: { seed: 1, sample } }],
  ]
  // Decided as is, decided on a row that changed since, submitted, merged, and on rows that are gone, submitted or not.
  const decisions = [
    decision('passed'),
    decision('flagged', { rowHash: 'old', action: 'edit', severity: 'major' }),
    decision('reported', { action: 'edit', severity: 'major' }),
    decision('stale', { submission: 7 }),
    decision('second', { action: 'drop', severity: 'minor', submission: 8 }),
    decision('left', { action: 'edit', severity: 'major', submission: 7 }),
    decision('gone'),
  ]
  const subs: SubmissionRow[] = [
    { id: 7, assignment: 1, branch: 'x', pr: 1, url: null, count: 2, leftOut: 0, status: 'open', createdAt: 't' },
    { id: 8, assignment: 1, branch: 'y', pr: 2, url: null, count: 1, leftOut: 0, status: 'merged', createdAt: 't' },
  ]
  const brief = (rows: readonly { key: string; rowHash: string }[]) => rows.map((r) => `${r.key} ${r.rowHash}`).sort()

  it.each(cases)('gives %s the rows of its files and the same progress and spot-check result, reading no file', async (_, assignment) => {
    const files = (await assignmentRows(fromFiles, assignment))!
    const hashes = (await assignmentHashes(fromDigest, assignment))!
    expect(brief(hashes)).toEqual(brief(files.rows))
    expect(progress(hashes, decisions, subs)).toEqual(progress(files.rows, decisions, subs))
    if (assignment.spotCheck) expect(spotCheckResult(assignment.spotCheck.sample, hashes, decisions)).toEqual(spotCheckResult(assignment.spotCheck.sample, files.rows, decisions))
  })

  it('reads the files when the snapshot has no digest (built before them)', async () => {
    for (const [, assignment] of cases) expect(brief((await assignmentHashes(fromFiles, assignment))!)).toEqual(brief((await assignmentRows(fromFiles, assignment))!.rows))
  })

  it('is null when a file in scope is missing from the digest, as when it is missing from R2', async () => {
    const partial: Snapshot = { ...fromDigest, digest: async () => ({ files: { [a]: digest.files[a]! } }) }
    expect(await assignmentHashes(partial, cases[1]![1])).toBeNull()
    expect(await assignmentHashes(partial, cases[0]![1])).not.toBeNull()
  })
})
