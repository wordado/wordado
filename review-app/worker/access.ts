import { b64url } from './b64'
import type { Deps } from './app'

interface Claims { email?: unknown; aud?: unknown; iss?: unknown; exp?: unknown }

/** Cloudflare Access's JWT (spec 2026-10-05 §10): RS256 against the team's keys, audience, issuer, expiry. */
export type AccessKeys = (opts?: { refresh?: boolean }) => Promise<readonly JsonWebKey[]>

export async function verifyAccessJwt(
  token: string,
  opts: { aud: string; issuer: string; keys: AccessKeys; now: Date },
): Promise<{ email: string } | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, s] = parts as [string, string, string]
  let header: { alg?: unknown; kid?: unknown }
  let claims: Claims
  let sig: Uint8Array<ArrayBuffer>
  try {
    header = JSON.parse(b64url.decodeText(h)) as typeof header
    claims = JSON.parse(b64url.decodeText(p)) as Claims
    sig = b64url.decode(s) as Uint8Array<ArrayBuffer>
  } catch {
    return null
  }
  if (typeof header !== 'object' || header === null || typeof claims !== 'object' || claims === null) return null
  if (header.alg !== 'RS256') return null
  const matching = (keys: readonly JsonWebKey[]) => keys.filter((k) => header.kid === undefined || (k as { kid?: unknown }).kid === header.kid)
  const data = new TextEncoder().encode(`${h}.${p}`)
  let valid = false
  try {
    let candidates = matching(await opts.keys())
    // Access rotates its signing keys: a kid we have not seen may be a new key, so look once more past the cache.
    if (candidates.length === 0 && header.kid !== undefined) candidates = matching(await opts.keys({ refresh: true }))
    for (const jwk of candidates) {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
      if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data)) {
        valid = true
        break
      }
    }
  } catch {
    // Keys that cannot be fetched or imported sign nobody in: answered 401, not 500.
    return null
  }
  if (!valid) return null
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!auds.includes(opts.aud)) return null
  if (claims.iss !== opts.issuer) return null
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= opts.now.getTime()) return null
  if (typeof claims.email !== 'string' || claims.email === '') return null
  return { email: claims.email.toLowerCase() }
}

let cached: { url: string; at: number; keys: readonly JsonWebKey[] } | null = null
let lastRefresh: { url: string; at: number } | null = null
let warnedProdJwks = false

/** ACCESS_JWKS is honoured only where nobody but a developer or a test can reach the Worker. */
function jwksAllowed(origin: string): boolean {
  if (origin === 'https://review.test') return true
  try {
    const u = new URL(origin)
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
  } catch {
    return false
  }
}

/**
 * The keys Access signs with: ACCESS_JWKS on a local or test origin (wrangler dev, e2e, unit tests), else
 * the team's certs, cached for an hour. Anywhere else ACCESS_JWKS is ignored even if it were ever set as a
 * Worker secret: scripts/check-config.ts only inspects wrangler.jsonc and would never see a secret, so
 * honoring it there would let anyone holding that key's private half sign in as any reviewer, including
 * the admin. `refresh` (a token with an unknown kid) bypasses the cache, at most once a minute.
 */
export function accessKeys(deps: Deps): AccessKeys {
  return async (opts) => {
    if (deps.env.ACCESS_JWKS) {
      if (jwksAllowed(deps.env.APP_ORIGIN)) return (JSON.parse(deps.env.ACCESS_JWKS) as { keys: JsonWebKey[] }).keys
      if (!warnedProdJwks) {
        warnedProdJwks = true
        deps.log(`ACCESS_JWKS is set but ignored: ${deps.env.APP_ORIGIN} is not a local or test origin (production)`)
      }
    }
    const url = `https://${deps.env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`
    const now = deps.now().getTime()
    const fresh = cached !== null && cached.url === url && now - cached.at < 3_600_000
    if (fresh && !opts?.refresh) return cached!.keys
    if (fresh && opts?.refresh && lastRefresh !== null && lastRefresh.url === url && now - lastRefresh.at < 60_000) return cached!.keys
    if (opts?.refresh) lastRefresh = { url, at: now }
    const res = await deps.fetch(url)
    if (!res.ok) throw new Error(`Access certs: ${res.status}`)
    const keys = ((await res.json()) as { keys: JsonWebKey[] }).keys
    cached = { url, at: now, keys }
    return keys
  }
}
