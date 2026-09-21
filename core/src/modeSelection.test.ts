import { describe, expect, it } from 'vitest'
import type { MasteryTier } from './mastery'
import { chooseMode } from './modeSelection'
import { seededRng } from './rng'
import type { Mode } from './types'

const ALL = new Set<Mode>(['flashcard', 'multiple_choice', 'listening_select', 'matching'])
const NO_AUDIO = new Set<Mode>(['flashcard', 'multiple_choice', 'matching'])

function picks(tier: MasteryTier, available: ReadonlySet<Mode>): Set<Mode> {
  const rng = seededRng(99)
  return new Set(Array.from({ length: 200 }, () => chooseMode(tier, available, rng)))
}

describe('chooseMode', () => {
  it('uses recognition modes while a word is new or learning', () => {
    expect(picks('new', ALL)).toEqual(new Set(['multiple_choice', 'listening_select']))
    expect(picks('learning', ALL)).toEqual(new Set(['multiple_choice', 'listening_select']))
  })

  it('escalates to recall once a word is young or mature', () => {
    expect(picks('young', ALL)).toEqual(new Set(['flashcard']))
    expect(picks('mature', ALL)).toEqual(new Set(['flashcard']))
  })

  it('never picks listening when audio is unavailable', () => {
    for (const tier of ['new', 'learning', 'young', 'mature'] as const) {
      expect(picks(tier, NO_AUDIO).has('listening_select')).toBe(false)
    }
  })

  it('never picks matching', () => {
    for (const tier of ['new', 'learning', 'young', 'mature'] as const) {
      expect(picks(tier, ALL).has('matching')).toBe(false)
    }
  })

  it('falls back to the other group rather than failing', () => {
    expect(chooseMode('new', new Set<Mode>(['flashcard']), seededRng(1))).toBe('flashcard')
    expect(chooseMode('mature', new Set<Mode>(['multiple_choice']), seededRng(1))).toBe('multiple_choice')
  })

  it('throws when nothing schedulable is available', () => {
    expect(() => chooseMode('new', new Set<Mode>(['matching']), seededRng(1))).toThrow()
  })
})
