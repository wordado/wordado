import { describe, expect, it } from 'vitest'
import { Decisions, QUEUES } from './decisions'
import type { Draft, DraftEntry } from './draft'
import { pendingItems } from './queues'
import { reopenReviewed } from './reopen'
import { makeContent } from './testing/fixture'

const entry = (entry_id: string): DraftEntry => ({
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
  english: { ipa: 'ˈwɔːtə', variants: [], examples: ['I drink water.'] },
  l1: { bg: { translation: 'вода', alternates: [], sense: '' } },
})
const entries = ['water-1', 'tea-1', 'milk-1', 'bread-1'].map(entry)
const draft: Draft = { live: entries.map((e) => e.entry_id), entries, units: [], problems: [] }
const T = QUEUES.translation('bg')
const AT = '2026-10-01T10:00:00Z'
const LATER = '2026-11-01T10:00:00Z'

/** water ok, tea fixed, milk dropped, bread not reviewed. */
function reviewed(): { dir: string; decisions: Decisions } {
  const dir = makeContent()
  const decisions = Decisions.read(dir)
  const proposed = entries[0]!.l1['bg']
  decisions.append(T, [
    { key: 'water-1', at: AT, verdict: 'ok', proposed, by: 'Мария' },
    { key: 'tea-1', at: AT, verdict: 'fix', proposed, value: { translation: 'чай', alternates: [], sense: '' }, by: 'Мария' },
    { key: 'milk-1', at: AT, verdict: 'drop', proposed, by: 'Мария' },
  ])
  return { dir, decisions }
}

describe('reopenReviewed', () => {
  it('sends every reviewed item of a queue back, keeping a fix as the value to review; skips drops and open items', () => {
    const { dir, decisions } = reviewed()
    const out = reopenReviewed(decisions, T, { keys: 'all', by: 'Yordan', note: 'second review', now: LATER })
    expect(out).toEqual({ reopened: ['water-1', 'tea-1'], skipped: ['milk-1: dropped'] })
    const items = pendingItems(draft, Decisions.read(dir), ['bg']).get(T)!
    expect(items.map((i) => [i.key, (i.proposed as { translation: string }).translation, i.context['reopened']])).toEqual([
      ['water-1', 'вода', 'second review'],
      ['tea-1', 'чай', 'second review'],
      ['bread-1', 'вода', ''],
    ])
  })

  it('reopens only the keys given, and says why it skipped the rest', () => {
    const { decisions } = reviewed()
    const out = reopenReviewed(decisions, T, { keys: ['tea-1', 'bread-1', 'milk-1', 'tea-1'], by: 'Yordan', note: '', now: LATER })
    expect(out).toEqual({ reopened: ['tea-1'], skipped: ['bread-1: not reviewed yet', 'milk-1: dropped'] })
    expect(decisions.for(T, 'tea-1').at(-1)).toEqual({ key: 'tea-1', at: LATER, verdict: 'reopen', by: 'Yordan' })
    expect(reopenReviewed(decisions, T, { keys: ['tea-1'], by: 'Yordan', note: '', now: LATER }).skipped).toEqual(['tea-1: already reopened'])
  })

  it('refuses audio, and a reopen without a name', () => {
    const { decisions } = reviewed()
    expect(() => reopenReviewed(decisions, QUEUES.audio, { keys: 'all', by: 'Yordan', note: '', now: LATER })).toThrow(/redo/)
    expect(() => reopenReviewed(decisions, T, { keys: 'all', by: ' ', note: '', now: LATER })).toThrow(/--by/)
  })
})
