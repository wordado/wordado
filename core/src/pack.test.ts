import { describe, expect, it } from 'vitest'
import { canonicalJson } from './pack'

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    )
  })

  it('keeps array order and drops undefined fields', () => {
    expect(canonicalJson({ list: [2, 1], gone: undefined, kept: null })).toBe('{"kept":null,"list":[2,1]}')
  })

  it('is a fixed point: parsing and re-encoding gives the same string', () => {
    const once = canonicalJson({ z: [1, { b: 'ю', a: 'a' }], a: 1.5 })
    expect(canonicalJson(JSON.parse(once))).toBe(once)
  })

  it('sorts by code unit, not by locale, so every machine agrees', () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, _x: 4 })).toBe('{"B":2,"_x":4,"a":3,"b":1}')
  })
})
