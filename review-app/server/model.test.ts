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
