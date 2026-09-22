import { describe, expect, it } from 'vitest'
import {
  CAPABILITIES,
  canUse,
  DEFAULT_ENTITLEMENT,
  effectiveEntitlement,
  ENTITLEMENT_STALE_AFTER_MS,
  isStale,
  type Entitlement,
} from './entitlement'

const NOW = Date.UTC(2026, 0, 10, 12, 0)
const DAY = 86_400_000

const plus: Entitlement = {
  tier: 'plus',
  source: 'web',
  expiresAt: NOW + 30 * DAY,
  quotas: { enrichmentPerDay: 500 },
  version: 7,
  staleAfter: NOW + ENTITLEMENT_STALE_AFTER_MS,
}

describe('effectiveEntitlement', () => {
  it('falls back to the default with no cached copy', () => {
    expect(effectiveEntitlement(null, NOW)).toBe(DEFAULT_ENTITLEMENT)
    expect(effectiveEntitlement(undefined, NOW)).toBe(DEFAULT_ENTITLEMENT)
  })

  it('honours the cached copy until expiresAt, however stale, and not after', () => {
    const stale = { ...plus, staleAfter: NOW - 90 * DAY }
    expect(effectiveEntitlement(stale, NOW)).toBe(stale)
    expect(effectiveEntitlement(stale, plus.expiresAt! - 1)).toBe(stale)
    expect(effectiveEntitlement(stale, plus.expiresAt!)).toBe(DEFAULT_ENTITLEMENT)
  })

  it('never expires the default tier', () => {
    expect(DEFAULT_ENTITLEMENT.expiresAt).toBeNull()
    expect(effectiveEntitlement(DEFAULT_ENTITLEMENT, NOW + 10_000 * DAY)).toBe(DEFAULT_ENTITLEMENT)
  })
})

describe('canUse', () => {
  it('keeps studying free: every learner has theme collections and an enrichment allowance', () => {
    expect(canUse('collections.theme', null, NOW)).toBe(true)
    expect(canUse('enrichment', null, NOW)).toBe(true)
    expect(DEFAULT_ENTITLEMENT.quotas.enrichmentPerDay).toBeGreaterThan(0)
  })

  it('gates the extras on the cached entitlement, offline or on', () => {
    expect(canUse('capture.paste', null, NOW)).toBe(false)
    expect(canUse('collections.exam', DEFAULT_ENTITLEMENT, NOW)).toBe(false)
    expect(canUse('capture.paste', plus, NOW)).toBe(true)
    expect(canUse('capture.paste', plus, plus.expiresAt!)).toBe(false)
  })

  it('answers for every named capability', () => {
    for (const capability of CAPABILITIES) {
      expect(typeof canUse(capability, plus, NOW)).toBe('boolean')
      expect(canUse(capability, plus, NOW)).toBe(true)
    }
  })
})

describe('isStale', () => {
  it('asks for a refresh from staleAfter on, and always without a copy', () => {
    expect(isStale(null, NOW)).toBe(true)
    expect(isStale(plus, plus.staleAfter - 1)).toBe(false)
    expect(isStale(plus, plus.staleAfter)).toBe(true)
  })
})
