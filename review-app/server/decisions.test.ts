import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { csvRecords } from '@wordado/pipeline/csv'
import { Decisions } from '@wordado/pipeline/decisions'
import { describe, expect, it } from 'vitest'
import { runImport, saveDecision } from './decisions'
import { reviewFixture } from './fixture'
import { listRows } from './model'

async function flagged() {
  const dir = await reviewFixture()
  const row = listRows(dir, 'translation-bg', { withUnflagged: false }).find((r) => r.key.startsWith('bank-'))!
  return { dir, row }
}
const rowIn = (dir: string, file: string, key: string) => csvRecords(readFileSync(join(dir, file), 'utf8')).rows.find((r) => r['key'] === key)!

describe('saveDecision', () => {
  it('writes an accepted fix as ok with the new cells, keeping quotes, commas and lists', async () => {
    const { dir, row } = await flagged()
    const cells = { ...row.cells, translation: 'брег', alternates: 'бряг | "речен" бряг, край' }
    const res = saveDecision(dir, { queue: row.queue, file: row.file, version: row.version, key: row.key, action: 'accept', cells, note: 'река' })
    expect(res.ok).toBe(true)
    const r = rowIn(dir, row.file, row.key)
    expect([r['verdict'], r['translation'], r['alternates'], r['note']]).toEqual(['ok', 'брег', 'бряг | "речен" бряг, край', 'река'])
    const result = runImport(dir, 'tester', '2026-10-05T00:00:00Z')
    expect(result.errors).toEqual([])
    const events = Decisions.read(dir).for('translation-bg', row.key)
    expect(events.at(-1)).toMatchObject({ verdict: 'fix', by: 'tester', value: { translation: 'брег', alternates: ['бряг', '"речен" бряг, край'] } })
  })

  it('writes keep as ok and drop as drop, and leaves every other row as it was', async () => {
    const { dir, row } = await flagged()
    const before = csvRecords(readFileSync(join(dir, row.file), 'utf8')).rows.filter((r) => r['key'] !== row.key)
    saveDecision(dir, { queue: row.queue, file: row.file, version: row.version, key: row.key, action: 'drop', cells: row.cells })
    expect(rowIn(dir, row.file, row.key)['verdict']).toBe('drop')
    expect(csvRecords(readFileSync(join(dir, row.file), 'utf8')).rows.filter((r) => r['key'] !== row.key)).toEqual(before)
  })

  it('refuses to overwrite a file that changed since it was loaded', async () => {
    const { dir, row } = await flagged()
    writeFileSync(join(dir, row.file), readFileSync(join(dir, row.file), 'utf8') + '')  // same text: same version, allowed
    expect(saveDecision(dir, { queue: row.queue, file: row.file, version: row.version, key: row.key, action: 'keep', cells: row.cells }).ok).toBe(true)
    const res = saveDecision(dir, { queue: row.queue, file: row.file, version: row.version, key: row.key, action: 'keep', cells: row.cells })
    expect(res).toMatchObject({ ok: false, reason: 'changed' })
  })

  it('answers gone for a file import deleted, and invalid for a drop of a level', async () => {
    const { dir, row } = await flagged()
    const level = listRows(dir, 'level', { withUnflagged: true })[0]
    expect(saveDecision(dir, { queue: row.queue, file: 'review/translation-bg/none.csv', version: 'x', key: row.key, action: 'keep', cells: row.cells })).toMatchObject({ ok: false, reason: 'gone' })
    if (level) expect(saveDecision(dir, { queue: 'level', file: level.file, version: level.version, key: level.key, action: 'drop', cells: level.cells })).toMatchObject({ ok: false, reason: 'invalid' })
  })
})
