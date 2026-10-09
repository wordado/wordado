import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { csvRecords, formatCsv, parseCsv } from './csv'
import { Decisions, QUEUES } from './decisions'
import type { Draft, DraftEntry } from './draft'
import { aliveKeys, exportQueues, importQueues, levelSampled, pendingItems, queueSpecs, splitList } from './queues'
import { makeContent } from './testing/fixture'

const entry = (entry_id: string, extra: Partial<DraftEntry> = {}): DraftEntry => ({
  entry_id,
  headword: entry_id.replace(/-\d+$/, ''),
  pos: 'noun',
  sense_en: '',
  rank: 1,
  order: 0,
  pinned: false,
  essential: false,
  band: 'A1',
  level_proposal: 'A1',
  level: 'A1',
  level_flagged: false,
  themes: [],
  english: { ipa: 'ˈwɔːtə', variants: [], examples: ['Water, please.', 'I drink water.'] },
  l1: { bg: { translation: 'вода', alternates: ['водичка'], sense: '' } },
  ...extra,
})
const draft = (entries: DraftEntry[], live = entries.map((e) => e.entry_id)): Draft => ({
  live,
  entries,
  units: [{ unit_id: 'a1-01', level: 'A1', entry_ids: live, titles: { bg: { en: 'Water', l1: 'Вода' } } }],
  problems: [],
})
const specs = queueSpecs(['bg'])
const NOW = '2026-10-01T10:00:00Z'

function exportAll(dir: string, d: Draft): string[] {
  return exportQueues(dir, pendingItems(d, Decisions.read(dir), ['bg']), specs, { stamp: '2026-10-01', alive: aliveKeys(d, ['bg']) })
}

function editRow(dir: string, file: string, key: string, cells: Record<string, string>): void {
  const path = join(dir, file)
  const rows = parseCsv(readFileSync(path, 'utf8'))
  const header = rows[0]!
  const row = rows.find((r) => r[0] === key)!
  for (const [col, value] of Object.entries(cells)) row[header.indexOf(col)] = value
  writeFileSync(path, formatCsv(rows))
}

describe('pendingItems', () => {
  it('queues every live entry’s English and translation set, and each live unit’s title', () => {
    const items = pendingItems(draft([entry('water-1'), entry('gone-1')], ['water-1']), Decisions.read(makeContent()), ['bg'])
    expect(items.get('english')!.map((i) => i.key)).toEqual(['water-1'])
    expect(items.get('translation-bg')![0]).toMatchObject({ key: 'water-1', proposed: { translation: 'вода', alternates: ['водичка'], sense: '' } })
    expect(items.get('title-bg')!.map((i) => i.key)).toEqual(['a1-01'])
  })

  it('queues a level only when the band clamped it, or the entry is in the 1-in-20 sample', () => {
    const flagged = entry('a-1', { level_flagged: true })
    const ids = Array.from({ length: 200 }, (_, i) => `w${i}-1`)
    const sampled = ids.filter(levelSampled)
    expect(sampled.length).toBeGreaterThan(3)
    expect(sampled.length).toBeLessThan(20)
    const items = pendingItems(draft([flagged, ...ids.map((id) => entry(id))]), Decisions.read(makeContent()), ['bg'])
    expect(items.get('level')!.map((i) => i.key)).toEqual(['a-1', ...sampled])
  })

  it('leaves out what is reviewed, and brings back what reports reopened', () => {
    const dir = makeContent()
    const e = entry('water-1')
    const d = Decisions.read(dir)
    d.append(QUEUES.english, [{ key: 'water-1', at: NOW, verdict: 'ok', proposed: e.english, by: 'r' }])
    expect(pendingItems(draft([e]), Decisions.read(dir), ['bg']).get('english')).toEqual([])
    d.append(QUEUES.english, [{ key: 'water-1', at: NOW, verdict: 'reopen', by: 'reports', note: '2 reports: example' }])
    expect(pendingItems(draft([e]), Decisions.read(dir), ['bg']).get('english')![0]!.context).toMatchObject({ reopened: '2 reports: example' })
  })
})

describe('exportQueues and importQueues', () => {
  it('writes one CSV and its sidecar per queue, and skips items already in an open file', () => {
    const dir = makeContent()
    const files = exportAll(dir, draft([entry('water-1')]))
    expect(files).toEqual(['review/english/2026-10-01-01.csv', 'review/title-bg/2026-10-01-01.csv', 'review/translation-bg/2026-10-01-01.csv'])
    const { header, rows } = csvRecords(readFileSync(join(dir, 'review/translation-bg/2026-10-01-01.csv'), 'utf8'))
    expect(header).toEqual(['key', 'verdict', 'translation', 'alternates', 'sense', 'headword', 'pos', 'sense_en', 'level', 'example', 'reopened', 'note'])
    expect(rows[0]).toMatchObject({ key: 'water-1', verdict: '', translation: 'вода', alternates: 'водичка', example: 'Water, please.' })
    expect(exportAll(dir, draft([entry('water-1')]))).toEqual([])
  })

  it('re-issues a row whose open file holds an older proposal, and takes it out of that file', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1'), entry('bread-1')]))
    const old = 'review/translation-bg/2026-10-01-01.csv'
    const changed = entry('water-1', { l1: { bg: { translation: 'водата', alternates: [], sense: '' } } })
    expect(exportAll(dir, draft([changed, entry('bread-1')]))).toEqual(['review/translation-bg/2026-10-01-02.csv'])
    expect(csvRecords(readFileSync(join(dir, old), 'utf8')).rows.map((r) => r['key'])).toEqual(['bread-1'])
    expect(JSON.parse(readFileSync(join(dir, old.replace('.csv', '.json')), 'utf8')).items.map((i: { key: string }) => i.key)).toEqual(['bread-1'])
    const fresh = 'review/translation-bg/2026-10-01-02.csv'
    expect(csvRecords(readFileSync(join(dir, fresh), 'utf8')).rows).toMatchObject([{ key: 'water-1', translation: 'водата' }])
    editRow(dir, fresh, 'water-1', { verdict: 'ok' })
    importQueues(dir, specs, { by: 'Мария', now: NOW })
    expect(Decisions.read(dir).all('translation-bg')).toMatchObject([{ key: 'water-1', verdict: 'ok', proposed: { translation: 'водата' } }])
    expect(exportAll(dir, draft([changed, entry('bread-1')]))).toEqual([])
  })

  it('removes an open file left with no rows, and keeps a stale row that already has a verdict', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1')]))
    const changed = entry('water-1', { english: { ipa: 'ˈwɔːtər', variants: [], examples: ['Water, please.'] }, l1: { bg: { translation: 'водата', alternates: [], sense: '' } } })
    editRow(dir, 'review/english/2026-10-01-01.csv', 'water-1', { verdict: 'ok' })
    expect(exportAll(dir, draft([changed]))).toEqual(['review/translation-bg/2026-10-01-01.csv'])
    expect(readdirSync(join(dir, 'review/translation-bg'))).toEqual(['2026-10-01-01.csv', '2026-10-01-01.json'])
    expect(csvRecords(readFileSync(join(dir, 'review/translation-bg/2026-10-01-01.csv'), 'utf8')).rows).toMatchObject([{ key: 'water-1', translation: 'водата' }])
    expect(csvRecords(readFileSync(join(dir, 'review/english/2026-10-01-01.csv'), 'utf8')).rows).toMatchObject([{ key: 'water-1', verdict: 'ok', ipa: 'ˈwɔːtə' }])
  })

  it('takes out a row whose entry left the course, or whose unit has no words', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1'), entry('bread-1')]))
    // bread-1 is no longer live: its english and translation rows go; the title row stays, the unit still has water-1.
    expect(exportAll(dir, draft([entry('water-1'), entry('bread-1')], ['water-1']))).toEqual([])
    for (const queue of ['english', 'translation-bg']) {
      expect(csvRecords(readFileSync(join(dir, `review/${queue}/2026-10-01-01.csv`), 'utf8')).rows.map((r) => r['key'])).toEqual(['water-1'])
      expect(JSON.parse(readFileSync(join(dir, `review/${queue}/2026-10-01-01.json`), 'utf8')).items.map((i: { key: string }) => i.key)).toEqual(['water-1'])
    }
    expect(csvRecords(readFileSync(join(dir, 'review/title-bg/2026-10-01-01.csv'), 'utf8')).rows.map((r) => r['key'])).toEqual(['a1-01'])
    // No live word is left: the unit's title row goes too, and its file with it.
    expect(exportAll(dir, draft([entry('water-1'), entry('bread-1')], []))).toEqual([])
    expect(existsSync(join(dir, 'review/title-bg/2026-10-01-01.csv'))).toBe(false)
    expect(existsSync(join(dir, 'review/title-bg/2026-10-01-01.json'))).toBe(false)
    // Live again: the row is written again.
    expect(exportAll(dir, draft([entry('water-1'), entry('bread-1')], ['water-1']))).toEqual(['review/english/2026-10-01-01.csv', 'review/title-bg/2026-10-01-01.csv', 'review/translation-bg/2026-10-01-01.csv'])
  })

  it('keeps a row that is no longer pending while its entry is live', () => {
    const dir = makeContent()
    const flagged = entry('water-1', { level_flagged: true })
    exportAll(dir, draft([flagged]))
    expect(readdirSync(join(dir, 'review/level'))).toEqual(['2026-10-01-01.csv', '2026-10-01-01.json'])
    // A later draft no longer flags the level (after `--rebuild`): the row waits for its review all the same.
    expect(exportAll(dir, draft([entry('water-1')]))).toEqual([])
    expect(csvRecords(readFileSync(join(dir, 'review/level/2026-10-01-01.csv'), 'utf8')).rows.map((r) => r['key'])).toEqual(['water-1'])
  })

  it('keeps a row of an entry that left the course when it has a verdict waiting for import', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1'), entry('bread-1')]))
    editRow(dir, 'review/translation-bg/2026-10-01-01.csv', 'bread-1', { verdict: 'drop', note: 'not a word' })
    exportAll(dir, draft([entry('water-1'), entry('bread-1')], ['water-1']))
    expect(csvRecords(readFileSync(join(dir, 'review/translation-bg/2026-10-01-01.csv'), 'utf8')).rows.map((r) => r['key'])).toEqual(['water-1', 'bread-1'])
    expect(importQueues(dir, specs, { by: 'Мария', now: NOW }).applied).toBe(1)
  })

  it('ok on an untouched row is ok; ok on edited cells is a fix; drop is a drop', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1'), entry('bread-1'), entry('salt-1')]))
    const file = 'review/translation-bg/2026-10-01-01.csv'
    editRow(dir, file, 'water-1', { verdict: 'ok' })
    editRow(dir, file, 'bread-1', { verdict: 'OK ', alternates: 'водичка | вода от чешмата' })
    editRow(dir, file, 'salt-1', { verdict: 'drop', note: 'not A1' })
    // pending: the three english rows and the one title row are still open.
    expect(importQueues(dir, specs, { by: 'Мария', now: NOW })).toEqual({ applied: 3, pending: 4, errors: [] })
    const events = Decisions.read(dir).all('translation-bg')
    expect(events.map((e) => [e.key, e.verdict])).toEqual([['water-1', 'ok'], ['bread-1', 'fix'], ['salt-1', 'drop']])
    expect(events[1]!.value).toEqual({ translation: 'вода', alternates: ['водичка', 'вода от чешмата'], sense: '' })
    expect(events[2]).toMatchObject({ by: 'Мария', note: 'not A1', at: NOW })
    expect(existsSync(join(dir, file))).toBe(false)
  })

  it('keeps undecided rows, with the reviewer’s edits, in the file', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1'), entry('bread-1')]))
    const file = 'review/translation-bg/2026-10-01-01.csv'
    editRow(dir, file, 'water-1', { verdict: 'ok' })
    editRow(dir, file, 'bread-1', { sense: 'половин мисъл' })
    importQueues(dir, specs, { by: 'r', now: NOW })
    const { rows } = csvRecords(readFileSync(join(dir, file), 'utf8'))
    expect(rows).toEqual([expect.objectContaining({ key: 'bread-1', sense: 'половин мисъл' })])
    expect(JSON.parse(readFileSync(join(dir, file.replace(/\.csv$/, '.json')), 'utf8')).items.map((i: { key: string }) => i.key)).toEqual(['bread-1'])
  })

  it('reads a file re-saved by a spreadsheet: no BOM, LF line ends, a dropped trailing cell', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1')]))
    const file = join(dir, 'review/english/2026-10-01-01.csv')
    const [header, row] = parseCsv(readFileSync(file, 'utf8'))
    row![1] = 'ok'
    writeFileSync(file, [header!.join(','), row!.slice(0, -1).map((c) => (/[",\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(',')].join('\n'))
    expect(importQueues(dir, specs, { by: 'r', now: NOW }).applied).toBe(1)
  })

  it('rejects an unknown verdict and applies nothing from that row; the other rows still apply', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1'), entry('bread-1')]))
    const file = 'review/translation-bg/2026-10-01-01.csv'
    editRow(dir, file, 'water-1', { verdict: 'yes' })
    editRow(dir, file, 'bread-1', { verdict: 'ok' })
    const out = importQueues(dir, specs, { by: 'r', now: NOW })
    expect(out.errors).toEqual(['review/translation-bg/2026-10-01-01.csv water-1: verdict "yes" is not one of ok, drop'])
    expect(Decisions.read(dir).all('translation-bg').map((e) => e.key)).toEqual(['bread-1'])
  })

  it('rejects an ok on cells that are not a valid value, and a row the sidecar does not know', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1')]))
    const file = 'review/translation-bg/2026-10-01-01.csv'
    editRow(dir, file, 'water-1', { verdict: 'ok', translation: ' ' })
    const rows = parseCsv(readFileSync(join(dir, file), 'utf8'))
    rows.push(['stranger-1', 'ok'])
    writeFileSync(join(dir, file), formatCsv(rows))
    expect(importQueues(dir, specs, { by: 'r', now: NOW }).errors).toEqual([
      'review/translation-bg/2026-10-01-01.csv water-1: translation is empty',
      'review/translation-bg/2026-10-01-01.csv stranger-1: not an item of this file',
    ])
  })

  it('needs a reviewer name', () => {
    expect(() => importQueues(makeContent(), specs, { by: ' ', now: NOW })).toThrow(/--by/)
  })
})

describe('splitList', () => {
  it('splits on the bar, trims, and drops empty items', () => {
    expect(splitList(' a |b||  c ')).toEqual(['a', 'b', 'c'])
  })
})

it('writes nothing for a queue with no items', () => {
  const dir = makeContent()
  exportQueues(dir, new Map([['english', []]]), specs, { stamp: '2026-10-01' })
  expect(existsSync(join(dir, 'review', 'english')) ? readdirSync(join(dir, 'review', 'english')) : []).toEqual([])
})
