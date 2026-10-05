import { describe, expect, it } from 'vitest'
import { verifyAccessJwt } from './access'
import { testKeys } from './test/jwt'

const env = { ACCESS_AUD: 'aud-test', ACCESS_TEAM_DOMAIN: 'team.example.com' }
const now = new Date()
const opts = (jwks: string) => ({ aud: 'aud-test', issuer: 'https://team.example.com', keys: async () => (JSON.parse(jwks) as { keys: JsonWebKey[] }).keys, now })

describe('verifyAccessJwt', () => {
  it('accepts a valid token and lower-cases the email', async () => {
    const k = await testKeys()
    expect(await verifyAccessJwt(await k.token('Anna@Example.com', env), opts(k.jwks))).toEqual({ email: 'anna@example.com' })
  })
  it('refuses the wrong audience, issuer, an expired token, and a bad signature', async () => {
    const k = await testKeys()
    const other = await testKeys()
    expect(await verifyAccessJwt(await k.token('a@example.com', { ...env, ACCESS_AUD: 'other' }), opts(k.jwks))).toBeNull()
    expect(await verifyAccessJwt(await k.token('a@example.com', { ...env, ACCESS_TEAM_DOMAIN: 'evil.example.com' }), opts(k.jwks))).toBeNull()
    expect(await verifyAccessJwt(await k.token('a@example.com', env, Math.floor(now.getTime() / 1000) - 10), opts(k.jwks))).toBeNull()
    expect(await verifyAccessJwt(await other.token('a@example.com', env), opts(k.jwks))).toBeNull()
    expect(await verifyAccessJwt('not.a.jwt', opts(k.jwks))).toBeNull()
    expect(await verifyAccessJwt('', opts(k.jwks))).toBeNull()
  })
})
