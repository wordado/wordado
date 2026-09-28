import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Decisions, foldField, type DecisionEvent } from './decisions'

const p = { translation: 'вода', alternates: [], sense: '' }
const ev = (e: Partial<DecisionEvent> & Pick<DecisionEvent, 'verdict'>): DecisionEvent => ({ key: 'water-1', at: '2026-10-01T00:00:00Z', by: 'r', ...e })

describe('foldField (Decision 5)', () => {
  it('is unreviewed with no events', () => {
    expect(foldField(p, [])).toEqual({ value: p, reviewed: false, dropped: false, reopened: false, stale: 0 })
  })

  it('an ok on this proposal reviews it; key order does not matter', () => {
    expect(foldField(p, [ev({ verdict: 'ok', proposed: { sense: '', alternates: [], translation: 'вода' } })]).reviewed).toBe(true)
  })

  it('a fix replaces the value and reviews it', () => {
    const fixed = { ...p, alternates: ['водичка'] }
    expect(foldField(p, [ev({ verdict: 'fix', proposed: p, value: fixed })])).toMatchObject({ value: fixed, reviewed: true })
  })

  it('a verdict on another proposal is stale and changes nothing', () => {
    expect(foldField(p, [ev({ verdict: 'ok', proposed: { ...p, translation: 'водата' } })])).toMatchObject({ reviewed: false, stale: 1 })
  })

  it('a reopen after a fix keeps the fixed value but asks for review again; an ok on the fixed value closes it', () => {
    const fixed = { ...p, translation: 'водица' }
    const events = [ev({ verdict: 'fix', proposed: p, value: fixed }), ev({ verdict: 'reopen', by: 'reports' })]
    expect(foldField(p, events)).toMatchObject({ value: fixed, reviewed: false, reopened: true })
    expect(foldField(p, [...events, ev({ verdict: 'ok', proposed: fixed })])).toMatchObject({ value: fixed, reviewed: true, reopened: false })
  })

  it('a drop on this proposal drops the entry', () => {
    expect(foldField(p, [ev({ verdict: 'drop', proposed: p })])).toMatchObject({ dropped: true, reviewed: true })
  })
})

describe('Decisions', () => {
  it('appends events per queue and reads them back by key in order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'decisions-'))
    Decisions.read(dir).append('translation-bg', [ev({ verdict: 'ok', proposed: p }), ev({ key: 'bread-1', verdict: 'drop', proposed: p })])
    Decisions.read(dir).append('translation-bg', [ev({ verdict: 'reopen' })])
    const d = Decisions.read(dir)
    expect(d.for('translation-bg', 'water-1').map((e) => e.verdict)).toEqual(['ok', 'reopen'])
    expect(d.for('english', 'water-1')).toEqual([])
  })
})
