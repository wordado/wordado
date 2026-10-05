import { b64url } from '../b64'
import type { Env } from '../bindings'

/** An RSA key pair for test tokens, its public JWKS as ACCESS_JWKS takes it, and a signer. */
export async function testKeys() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'test-kid', alg: 'RS256', use: 'sig' }
  const sign = async (claims: Record<string, unknown>, kid = 'test-kid') => {
    const head = b64url.encodeText(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }))
    const body = b64url.encodeText(JSON.stringify(claims))
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`))
    return `${head}.${body}.${b64url.encode(new Uint8Array(sig))}`
  }
  const token = (email: string, env: Pick<Env, 'ACCESS_AUD' | 'ACCESS_TEAM_DOMAIN'>, exp = Math.floor(Date.now() / 1000) + 3600) =>
    sign({ email, aud: [env.ACCESS_AUD], iss: `https://${env.ACCESS_TEAM_DOMAIN}`, exp, iat: exp - 3600 })
  return { jwks: JSON.stringify({ keys: [jwk] }), sign, token, privateKey: pair.privateKey }
}
