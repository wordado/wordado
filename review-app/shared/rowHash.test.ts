import { rowContent } from '@wordado/pipeline/aiReview/store'
import { describe, expect, it } from 'vitest'
import { rowHash } from './rowHash'

describe('rowHash', () => {
  it('equals the AI-review store key for the same row', async () => {
    const proposed = { translation: 'бряг', alternates: ['брегът'], sense: 'на река' }
    expect(await rowHash('translation-bg', proposed, '1 report: odd')).toBe(rowContent('translation-bg', proposed, '1 report: odd'))
    expect(await rowHash('level', 'B2', '')).toBe(rowContent('level', 'B2', ''))
  })
})
