/** One tier exists at launch; `plus` is the proposed second (spec §8.8, not approved). */
export const ENTITLEMENT_TIERS = ['free', 'plus'] as const
export type EntitlementTier = (typeof ENTITLEMENT_TIERS)[number]

/** Where the entitlement came from. Nothing else in the system knows a provider exists. */
export type EntitlementSource = 'default' | 'app_store' | 'play' | 'web' | 'grant'

/** The server-owned synced document (spec §8.8, §9.2). Read-only on clients. */
export interface Entitlement {
  readonly tier: EntitlementTier
  readonly source: EntitlementSource
  /** When the entitlement itself ends; null never. Not the cache's staleness. */
  readonly expiresAt: number | null
  readonly quotas: {
    readonly enrichmentPerDay: number
  }
  readonly version: number
  /** When the client should try to refresh its copy. A stale copy is still honoured. */
  readonly staleAfter: number
}

/** The named capabilities the one capability check knows (spec §8.8). Tuning (§15). */
export const CAPABILITIES = [
  'collections.theme',
  'collections.exam',
  'capture.paste',
  'capture.share',
  'capture.import',
  'capture.extension',
  'forecast',
  'streak.extra_freezes',
  'enrichment',
] as const
export type Capability = (typeof CAPABILITIES)[number]

const TIER_CAPABILITIES: Readonly<Record<EntitlementTier, ReadonlySet<Capability>>> = {
  free: new Set<Capability>(['collections.theme', 'enrichment']),
  plus: new Set<Capability>(CAPABILITIES),
}

/** How long a pulled copy is fresh for. Tuning (§15). */
export const ENTITLEMENT_STALE_AFTER_MS = 24 * 60 * 60 * 1000

/** Quota of the free tier. Tuning (§15). */
export const DEFAULT_ENRICHMENT_PER_DAY = 20

/** What every learner holds, and what a client falls back to after `expiresAt`. */
export const DEFAULT_ENTITLEMENT: Entitlement = {
  tier: 'free',
  source: 'default',
  expiresAt: null,
  quotas: { enrichmentPerDay: DEFAULT_ENRICHMENT_PER_DAY },
  version: 0,
  // This synthetic fallback was never pulled, so it is always due for a refresh.
  staleAfter: 0,
}

/**
 * The entitlement in force: the cached copy until its `expiresAt`, online or
 * off and however stale the copy; the default after (spec §8.8).
 */
export function effectiveEntitlement(cached: Entitlement | null | undefined, now: number): Entitlement {
  if (!cached) return DEFAULT_ENTITLEMENT
  if (cached.expiresAt !== null && now >= cached.expiresAt) return DEFAULT_ENTITLEMENT
  return cached
}

/** The one capability check. Nothing else asks whether a learner is paying. */
export function canUse(capability: Capability, cached: Entitlement | null | undefined, now: number): boolean {
  return TIER_CAPABILITIES[effectiveEntitlement(cached, now).tier].has(capability)
}

/** Whether the client should try to refresh its copy. Says nothing about what is honoured. */
export function isStale(cached: Entitlement | null | undefined, now: number): boolean {
  return !cached || now >= cached.staleAfter
}
