import { describe, expect, it } from 'vitest'
import { accessKeys, verifyAccessJwt } from './access'
import type { Deps } from './app'
import type { Env } from './bindings'
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

describe('accessKeys in production', () => {
  it('ignores ACCESS_JWKS, falls back to the team certs, and warns deps.log once', async () => {
    const secret = await testKeys() // what a stray ACCESS_JWKS production secret would hold
    const team = await testKeys() // what https://team.example.com/cdn-cgi/access/certs really serves
    const logs: string[] = []
    const prodEnv = {
      APP_ORIGIN: 'https://review.wordado.com',
      ACCESS_TEAM_DOMAIN: 'team.example.com',
      ACCESS_AUD: 'aud-test',
      ACCESS_JWKS: secret.jwks,
    } as unknown as Env
    const deps: Deps = {
      env: prodEnv,
      fetch: async () => new Response(team.jwks, { status: 200 }),
      now: () => new Date(),
      log: (line) => logs.push(line),
    }
    const keys = accessKeys(deps)
    const o = { aud: 'aud-test', issuer: 'https://team.example.com', keys, now: new Date() }

    expect(await verifyAccessJwt(await secret.token('a@example.com', prodEnv), o)).toBeNull()
    expect(await verifyAccessJwt(await team.token('a@example.com', prodEnv), o)).toEqual({ email: 'a@example.com' })
    expect(logs.filter((l) => l.includes('ACCESS_JWKS') && l.includes('production'))).toHaveLength(1)
  })
})
