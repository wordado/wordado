import { b64url } from './b64'
import type { Deps } from './app'

interface Claims { email?: unknown; aud?: unknown; iss?: unknown; exp?: unknown }

/** Cloudflare Access's JWT (spec 2026-10-05 §10): RS256 against the team's keys, audience, issuer, expiry. */
export async function verifyAccessJwt(
  token: string,
  opts: { aud: string; issuer: string; keys: () => Promise<readonly JsonWebKey[]>; now: Date },
): Promise<{ email: string } | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, s] = parts as [string, string, string]
  let header: { alg?: unknown; kid?: unknown }
  let claims: Claims
  try {
    header = JSON.parse(b64url.decodeText(h)) as typeof header
    claims = JSON.parse(b64url.decodeText(p)) as Claims
  } catch {
    return null
  }
  if (header.alg !== 'RS256') return null
  const candidates = (await opts.keys()).filter((k) => header.kid === undefined || (k as { kid?: unknown }).kid === header.kid)
  const data = new TextEncoder().encode(`${h}.${p}`)
  let sig: Uint8Array<ArrayBuffer>
  try {
    sig = b64url.decode(s) as Uint8Array<ArrayBuffer>
  } catch {
    return null
  }
  let valid = false
  for (const jwk of candidates) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data)) {
      valid = true
      break
    }
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

/** The keys Access signs with: ACCESS_JWKS when set (tests, e2e), else the team's certs, cached for an hour. */
export function accessKeys(deps: Deps): () => Promise<readonly JsonWebKey[]> {
  return async () => {
    if (deps.env.ACCESS_JWKS) return (JSON.parse(deps.env.ACCESS_JWKS) as { keys: JsonWebKey[] }).keys
    const url = `https://${deps.env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`
    const now = deps.now().getTime()
    if (cached && cached.url === url && now - cached.at < 3_600_000) return cached.keys
    const res = await deps.fetch(url)
    if (!res.ok) throw new Error(`Access certs: ${res.status}`)
    const keys = ((await res.json()) as { keys: JsonWebKey[] }).keys
    cached = { url, at: now, keys }
    return keys
  }
}
