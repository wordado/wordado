import { describe, expect, it } from 'vitest'
import type { RowView } from '../server/types'
import type { DecisionRow, SubmissionRow } from './db'
import { assignmentRows, progress, rank, withDecisions } from './rows'
import type { Snapshot } from './snapshotStore'

const row = (key: string, over: Partial<RowView> = {}): RowView => ({
  queue: 'translation-de', file: 'review/translation-de/a.csv', version: 'v', key, kind: 'translation', cells: {}, fields: [], context: {},
  otherSenses: [], reports: '', ai: 'passed', severity: null, objections: [], decided: null, stale: false, rowHash: `h-${key}`, ...over,
})
const decision = (key: string, over: Partial<DecisionRow> = {}): DecisionRow => ({
  assignment: 1, queue: 'translation-de', file: 'review/translation-de/a.csv', key, rowHash: `h-${key}`, action: 'keep', cells: {}, note: '', decidedAt: 't', submission: null, ...over,
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
  }
  const assignment = { id: 1, reviewer: 'r', queue: 'level', files: '*' as const, createdAt: 't', closedAt: null }

  it('gives a flagged-only assignment the flagged, reported and stale rows, worst first', async () => {
    const got = await assignmentRows(snap, { ...assignment, flaggedOnly: true })
    expect(got?.rows.map((r) => r.key)).toEqual(['reported', 'flagged', 'stale'])
    expect([...got!.keys]).toHaveLength(4)
  })

  it('gives an all-rows assignment every row in file order', async () => {
    const got = await assignmentRows(snap, { ...assignment, flaggedOnly: false })
    expect(got?.rows.map((r) => r.key)).toEqual(['passed', 'stale', 'flagged', 'reported'])
  })
})
