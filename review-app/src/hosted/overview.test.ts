import { describe, expect, it } from 'vitest'
import type { AssignmentView, ReviewerView, SnapshotStatus, SubmissionView } from '../../shared/hosted'
import { overviewOf } from './overview'

const file = (queue: string, name: string, flagged: number, reported: number) => ({ file: `review/${queue}/${name}.csv`, rows: 100, flagged, reported, assignedTo: null })
const snapshot: SnapshotStatus = {
  id: 's-1', built: '2026-10-05T10:00:00Z', commit: 'abcdef1234',
  queues: [
    { queue: 'translation-de', language: 'de', files: [file('translation-de', 'a', 5, 1), file('translation-de', 'b', 3, 0)] },
    { queue: 'title-de', language: 'de', files: [file('title-de', 'a', 2, 0)] },
    { queue: 'translation-es', language: 'es', files: [file('translation-es', 'a', 4, 0)] },
  ],
}
const reviewer = (name: string, over: Partial<ReviewerView> = {}): ReviewerView => ({ email: `${name.toLowerCase()}@example.com`, name, role: 'reviewer', languages: ['de'], invitedAt: 't', inviteSentAt: 't', disabledAt: null, ...over })
const reviewers = [reviewer('Anna'), reviewer('Hans'), reviewer('Carmen', { languages: ['es'], disabledAt: 't' })]
const assignment = (over: Partial<AssignmentView> = {}): AssignmentView => ({
  id: 1, reviewer: 'anna@example.com', reviewerName: 'Anna', queue: 'translation-de', files: '*', flaggedOnly: true, spotCheck: null, createdAt: 't', closedAt: null,
  progress: { inScope: 9, decided: 2, changed: 0, submitted: 1, merged: 0, remaining: 6 }, ...over,
})
const submission = (over: Partial<SubmissionView> = {}): SubmissionView => ({ id: 1, assignment: 1, reviewer: 'anna@example.com', reviewerName: 'Anna', queue: 'translation-de', branch: 'b', pr: 3, url: 'https://github.com/x/pull/3', count: 1, leftOut: 0, status: 'open', createdAt: 't', ...over })

describe('overviewOf', () => {
  const o = overviewOf({ snapshot, assignments: [assignment()], submissions: [submission()], reviewers })

  it('counts the rows to decide, the decisions not submitted, the open pull requests and the active reviewers', () => {
    expect(o.toDecide).toBe(15)
    expect(o.decided).toBe(2)
    expect(o.openPrs).toBe(1)
    expect(o.activeReviewers).toBe(2)
  })

  it('gives a row per language that has a queue, with its parts, its reviewers and how far it is', () => {
    expect(o.languages.map((l) => l.language)).toEqual(['de', 'es'])
    const [german, spanish] = o.languages
    expect(german).toEqual({ language: 'de', label: 'German', parts: '9 translations · 2 titles', reviewers: ['Anna'], flagged: 11, decided: 2, submitted: 1, state: 'on track' })
    expect(spanish).toEqual({ language: 'es', label: 'Spanish', parts: '4 translations', reviewers: [], flagged: 4, decided: 0, submitted: 0, state: 'unassigned' })
  })

  it('says one of a kind in the singular, and counts the levels as rows', () => {
    const one = overviewOf({
      snapshot: { ...snapshot, queues: [{ queue: 'translation-bg', language: 'bg', files: [file('translation-bg', 'a', 1, 0)] }, { queue: 'title-bg', language: 'bg', files: [file('title-bg', 'a', 0, 1)] }, { queue: 'level', language: 'en', files: [file('level', 'a', 21, 0)] }] },
      assignments: [], submissions: [], reviewers: [],
    })
    expect(one.languages.map((l) => [l.label, l.parts])).toEqual([['Bulgarian', '1 translation · 1 title'], ['English levels', '21 rows']])
  })

  it('calls a language with nothing flagged done, whoever holds it', () => {
    const done = overviewOf({ snapshot: { ...snapshot, queues: [{ queue: 'translation-de', language: 'de', files: [file('translation-de', 'a', 0, 0)] }] }, assignments: [assignment()], submissions: [], reviewers })
    expect(done.languages[0]).toMatchObject({ state: 'done', flagged: 0, parts: 'nothing left to decide' })
    expect(done.toDecide).toBe(0)
  })

  it('leaves closed assignments, other pull requests and each name’s repeats out', () => {
    const more = overviewOf({
      snapshot,
      assignments: [assignment(), assignment({ id: 2, queue: 'title-de' }), assignment({ id: 3, reviewer: 'hans@example.com', reviewerName: 'Hans', closedAt: 't' }), assignment({ id: 4, reviewer: 'hans@example.com', reviewerName: 'Hans', queue: 'title-de', progress: null })],
      submissions: [submission(), submission({ id: 2, status: 'merged' }), submission({ id: 3, status: 'closed' })],
      reviewers,
    })
    expect(more.languages[0]).toMatchObject({ reviewers: ['Anna', 'Hans'], decided: 4, submitted: 2 })
    expect(more.decided).toBe(4)
    expect(more.openPrs).toBe(1)
  })

  it('is empty without review data', () => {
    expect(overviewOf({ snapshot: null, assignments: [], submissions: [], reviewers })).toEqual({ toDecide: 0, decided: 0, openPrs: 0, activeReviewers: 2, languages: [] })
  })
})
