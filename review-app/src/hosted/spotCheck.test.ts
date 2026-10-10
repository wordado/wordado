import { describe, expect, it } from 'vitest'
import { resultLine } from './spotCheck'

describe('resultLine', () => {
  it('says the sample, what was checked and how it came out, noughts included', () => {
    expect(resultLine({ sample: 50, result: { checked: 12, fine: 9, minor: 2, serious: 1, seriousKeys: ['bank-2'] } })).toBe('50 in the sample · checked 12 · fine 9 · minor 2 · serious 1')
    expect(resultLine({ sample: 3, result: { checked: 0, fine: 0, minor: 0, serious: 0, seriousKeys: [] } })).toBe('3 in the sample · checked 0 · fine 0 · minor 0 · serious 0')
  })

  it('says so when there is no review data to count against', () => {
    expect(resultLine({ sample: 50, result: null })).toBe('50 in the sample · the review data is not available yet')
  })
})
