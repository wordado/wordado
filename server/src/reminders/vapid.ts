import type { VapidKeys } from '../deps'

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

const utf8 = (text: string) => new TextEncoder().encode(text)
const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const

/** A new key pair; `pnpm --filter @wordado/server vapid-keys` prints one for the Worker's secrets. */
export async function generateVapidKeys(subject: string): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey(P256, true, ['sign', 'verify'])) as CryptoKeyPair
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  if (!jwk.d) throw new Error('The private key did not export its scalar')
  return { publicKey: base64UrlEncode(publicKey), privateKey: jwk.d, subject }
}

export async function importVapidKeys(keys: VapidKeys): Promise<CryptoKey> {
  const point = base64UrlDecode(keys.publicKey)
  if (point.length !== 65 || point[0] !== 4) throw new Error('VAPID_PUBLIC_KEY must be an uncompressed P-256 point in base64url')
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(point.slice(1, 33)),
    y: base64UrlEncode(point.slice(33, 65)),
    d: keys.privateKey,
  }
  return crypto.subtle.importKey('jwk', jwk, P256, false, ['sign'])
}

/** How long one signed token is good for; RFC 8292 allows up to 24 hours. */
export const VAPID_TOKEN_SECONDS = 12 * 60 * 60

/** The `Authorization` header of RFC 8292 for one push service: an ES256 JWT and the public key. */
export async function vapidAuthorization(keys: VapidKeys, privateKey: CryptoKey, endpoint: string, now: number): Promise<string> {
  const header = base64UrlEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = base64UrlEncode(
    utf8(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + VAPID_TOKEN_SECONDS, sub: keys.subject })),
  )
  // WebCrypto's ECDSA signature is already JWS's r‖s form.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, utf8(`${header}.${claims}`))
  return `vapid t=${header}.${claims}.${base64UrlEncode(new Uint8Array(signature))}, k=${keys.publicKey}`
}
