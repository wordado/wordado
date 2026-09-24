import { describe, expect, it } from 'vitest'
import { isAboveLevel } from './level'

describe('isAboveLevel', () => {
  it('is true when the entry is above the declared level', () => {
    expect(isAboveLevel('A2', 'A1')).toBe(true)
  })

  it('is false at the same level', () => {
    expect(isAboveLevel('A1', 'A1')).toBe(false)
  })

  it('is false when the entry is below the declared level', () => {
    expect(isAboveLevel('A1', 'B1')).toBe(false)
  })
})
