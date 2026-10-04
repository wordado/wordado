import { contentPaths } from '@wordado/pipeline/content'
import { readDraft } from '@wordado/pipeline/draft'
import { writeJson } from '@wordado/pipeline/files'
import { describe, expect, it } from 'vitest'
import { reviewFixture } from './fixture'
import { listQueues, listRows } from './model'

describe('listRows', () => {
  it('puts reported rows first, then majors; hides passed rows unless asked', async () => {
    const dir = await reviewFixture()
    const rows = listRows(dir, 'translation-bg', { withUnflagged: false })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]!.reports).not.toBe('')
    expect(rows.every((r) => r.reports !== '' || r.ai === 'flagged')).toBe(true)
    const all = listRows(dir, 'translation-bg', { withUnflagged: true })
    expect(all.length).toBeGreaterThan(rows.length)
    expect(all.some((r) => r.ai === 'passed')).toBe(true)
  })

  it('shows a flagged row its cells, the field the objection targets, and other live senses', async () => {
    const dir = await reviewFixture()
    const bank = listRows(dir, 'translation-bg', { withUnflagged: false }).find((r) => r.key.startsWith('bank-'))!
    expect(bank.fields).toEqual(['translation', 'alternates', 'sense'])
    expect(bank.objections[0]).toMatchObject({ reviewer: 'flash', field: 'translation', severity: 'major' })
    expect(bank.severity).toBe('major')
    expect(bank.otherSenses.map((s) => s.key).some((k) => k.startsWith('bank-'))).toBe(true)
    expect(bank.file).toMatch(/^review\/translation-bg\/.+\.csv$/)
    expect(bank.version).toMatch(/^[0-9a-f]{64}$/)
  })

  it('shows the reopened row as passed when its AI verdict matches its current content', async () => {
    const dir = await reviewFixture()
    const reported = listRows(dir, 'translation-bg', { withUnflagged: true }).find((r) => r.reports !== '')!
    expect(reported.ai).toBe('passed')
    expect(reported.stale).toBe(false)
  })

  it('marks stale, and always shows, a row whose open file predates a newer draft', async () => {
    const dir = await reviewFixture()
    const draft = readDraft(dir)
    const nonBank = draft.live.filter((k) => !k.startsWith('bank-'))
    const key = nonBank[1]! // nonBank[0] is reviewFixture's reopened row; pick a different, unreported one
    const before = listRows(dir, 'translation-bg', { withUnflagged: false })
    expect(before.some((r) => r.key === key)).toBe(false) // passed, unreported, unflagged: hidden by default

    const moved = {
      ...draft,
      entries: draft.entries.map((e) =>
        e.entry_id === key ? { ...e, l1: { ...e.l1, bg: { ...e.l1['bg']!, translation: `${e.l1['bg']!.translation} (moved)` } } } : e,
      ),
    }
    writeJson(contentPaths(dir).draft, moved)

    const after = listRows(dir, 'translation-bg', { withUnflagged: false })
    const row = after.find((r) => r.key === key)!
    expect(row.stale).toBe(true)
  })
})

describe('listQueues', () => {
  it('counts open, flagged and reported rows per AI-reviewed queue', async () => {
    const dir = await reviewFixture()
    const q = listQueues(dir).find((x) => x.queue === 'translation-bg')!
    expect(q.flagged).toBeGreaterThan(0)
    expect(q.reported).toBe(1)
    expect(q.open).toBeGreaterThanOrEqual(q.flagged)
  })
})
