import { afterEach, describe, expect, it, vi } from 'vitest'
import { toHex, webEnv } from './env'

afterEach(() => vi.restoreAllMocks())

describe('webEnv', () => {
  it('reports the offset to ADD to UTC: the negation of getTimezoneOffset (plan 4 contract)', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-120)
    expect(webEnv().tzOffsetMin()).toBe(120)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300)
    expect(webEnv().tzOffsetMin()).toBe(-300)
  })

  it('reports UTC as 0, never -0', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0)
    expect(Object.is(webEnv().tzOffsetMin(), 0)).toBe(true)
  })

  it('makes v4 UUIDs and floats in [0, 1)', () => {
    const env = webEnv()
    expect(env.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    for (let i = 0; i < 100; i += 1) {
      const r = env.rng()
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThan(1)
    }
  })

  it('hashes with SHA-256 as lowercase hex', async () => {
    expect(await webEnv().sha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(toHex(new Uint8Array([0, 15, 255]).buffer)).toBe('000fff')
  })
})
