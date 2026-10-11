import { describe, expect, it } from 'vitest'
import { levelStatus, levelToOpen, unitReveal, unitsAtFirst, type UnitStatus } from './pathFolding'

const level = (name: string, statuses: readonly UnitStatus[], skipped = false) => ({ level: name, statuses, skipped })

describe('levelToOpen', () => {
  it('opens the level that holds the current unit', () => {
    const levels = [level('A1', ['complete', 'complete']), level('A2', ['complete', 'current', 'locked']), level('B1', ['locked'])]
    expect(levelToOpen(levels)).toBe('A2')
  })

  it('opens the first level with work left when no unit is current', () => {
    const levels = [level('A1', ['open', 'open'], true), level('A2', ['locked'])]
    expect(levelToOpen(levels)).toBe('A1')
  })

  it('opens the last level once everything is done', () => {
    expect(levelToOpen([level('A1', ['complete']), level('A2', ['mastered'])])).toBe('A2')
  })
})

describe('levelStatus', () => {
  it('names a folded level by what it holds', () => {
    expect(levelStatus(['complete', 'mastered'], false)).toBe('complete')
    expect(levelStatus(['locked', 'locked'], false)).toBe('locked')
    expect(levelStatus(['complete', 'current', 'locked'], false)).toBe('open')
    expect(levelStatus(['open'], true)).toBe('skipped')
  })
})

describe('unitsAtFirst', () => {
  it('folds the finished units, shows the current one and the next two, and hides the rest', () => {
    const statuses: UnitStatus[] = ['complete', 'complete', 'mastered', 'current', 'locked', 'locked', 'locked', 'locked']
    expect(unitsAtFirst(statuses)).toEqual({ done: [0, 1, 2], shown: [3, 4, 5], hidden: 2 })
  })

  it('starts at the first unit with work left when none is current', () => {
    expect(unitsAtFirst(['complete', 'open', 'locked'])).toEqual({ done: [0], shown: [1, 2], hidden: 0 })
  })

  it('keeps a unit still being learned in view, before the current one', () => {
    expect(unitsAtFirst(['complete', 'open', 'current', 'locked', 'locked', 'locked'])).toEqual({ done: [0], shown: [1, 2, 3, 4], hidden: 1 })
  })

  it('has nothing to fold on a fresh level', () => {
    expect(unitsAtFirst(['current', 'locked', 'locked', 'locked'])).toEqual({ done: [], shown: [0, 1, 2], hidden: 1 })
  })
})

describe('unitReveal', () => {
  const level = (name: string, statuses: UnitStatus[]) => ({ level: name, units: statuses.map((_, i) => ({ unitId: `${name}-${i}` })), statuses })
  const levels = [
    level('A1', ['complete', 'mastered', 'current', 'locked', 'locked', 'locked', 'locked']),
    level('A2', ['locked', 'locked']),
  ]

  it('opens another level with nothing more to unfold: an opened level shows every unit', () => {
    expect(unitReveal(levels, 'A1', 'A2-1')).toEqual({ level: 'A2', done: false, all: false })
  })

  it('needs nothing unfolded for a unit the short view shows', () => {
    expect(unitReveal(levels, 'A1', 'A1-2')).toEqual({ level: 'A1', done: false, all: false })
    expect(unitReveal(levels, 'A1', 'A1-4')).toEqual({ level: 'A1', done: false, all: false })
  })

  it('unfolds the finished units for one of them', () => {
    expect(unitReveal(levels, 'A1', 'A1-0')).toEqual({ level: 'A1', done: true, all: false })
  })

  it('shows every unit for one beyond the next few', () => {
    expect(unitReveal(levels, 'A1', 'A1-6')).toEqual({ level: 'A1', done: false, all: true })
  })

  it('knows no unit by an ID the path does not hold', () => {
    expect(unitReveal(levels, 'A1', 'nope')).toBeNull()
  })
})
