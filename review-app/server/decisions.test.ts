import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { csvRecords } from '@wordado/pipeline/csv'
import { Decisions } from '@wordado/pipeline/decisions'
import { describe, expect, it } from 'vitest'
import { runImport, saveDecision } from './decisions'
import { reviewFixture } from './fixture'
import { listRows } from './model'
import type { Action } from './types'

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

  it('refuses a crafted queue or a file that escapes its queue folder', async () => {
    const { dir, row } = await flagged()
    expect(
      saveDecision(dir, { queue: '../../..', file: '../../../etc/hosts.csv', version: 'x', key: row.key, action: 'keep', cells: row.cells }),
    ).toMatchObject({ ok: false, reason: 'invalid' })
    expect(
      saveDecision(dir, { queue: row.queue, file: 'review/translation-bg/../level/x.csv', version: 'x', key: row.key, action: 'keep', cells: row.cells }),
    ).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('keeps the existing note when a later decision sends none, and only overwrites it when one is given', async () => {
    const { dir, row } = await flagged()
    const first = saveDecision(dir, { queue: row.queue, file: row.file, version: row.version, key: row.key, action: 'keep', cells: row.cells, note: 'first note' })
    expect(first.ok).toBe(true)
    expect(rowIn(dir, row.file, row.key)['note']).toBe('first note')
    const second = saveDecision(dir, { queue: row.queue, file: row.file, version: (first as { ok: true; version: string }).version, key: row.key, action: 'keep', cells: row.cells, note: '' })
    expect(second.ok).toBe(true)
    expect(rowIn(dir, row.file, row.key)['note']).toBe('first note')
  })

  it('answers invalid for an action that is not accept, keep, edit or drop', async () => {
    const { dir, row } = await flagged()
    const res = saveDecision(dir, { queue: row.queue, file: row.file, version: row.version, key: row.key, action: 'nope' as Action, cells: row.cells })
    expect(res).toMatchObject({ ok: false, reason: 'invalid' })
    expect(rowIn(dir, row.file, row.key)['verdict']).toBe('') // untouched
  })

  it('answers changed for a decision against a file whose content changed from an external edit, not only through another decision', async () => {
    const { dir, row } = await flagged()
    const text = readFileSync(join(dir, row.file), 'utf8')
    writeFileSync(join(dir, row.file), `${text}\n`) // a reviewer's text editor added a trailing newline
    const res = saveDecision(dir, { queue: row.queue, file: row.file, version: row.version, key: row.key, action: 'keep', cells: row.cells })
    expect(res).toMatchObject({ ok: false, reason: 'changed' })
  })
})
