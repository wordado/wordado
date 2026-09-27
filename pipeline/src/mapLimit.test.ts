import { describe, expect, it } from 'vitest'
import { mapLimit } from './mapLimit'

describe('mapLimit', () => {
  it('keeps results in item order and never runs more than the limit at once', async () => {
    let running = 0
    let peak = 0
    const out = await mapLimit([30, 10, 20, 5], 2, async (ms, i) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, ms))
      running -= 1
      return i
    })
    expect(out).toEqual([0, 1, 2, 3])
    expect(peak).toBe(2)
  })

  it('rejects with the first failure and starts nothing after it', async () => {
    const started: number[] = []
    await expect(
      mapLimit([1, 2, 3, 4], 1, async (n) => {
        started.push(n)
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
    expect(started).toEqual([1, 2])
  })
})
