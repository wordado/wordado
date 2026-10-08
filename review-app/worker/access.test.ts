import { describe, expect, it } from 'vitest'
import { accessKeys, verifyAccessJwt } from './access'
import { b64url } from './b64'
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
      sleep: async () => undefined,
    }
    const keys = accessKeys(deps)
    const o = { aud: 'aud-test', issuer: 'https://team.example.com', keys, now: new Date() }

    expect(await verifyAccessJwt(await secret.token('a@example.com', prodEnv), o)).toBeNull()
    expect(await verifyAccessJwt(await team.token('a@example.com', prodEnv), o)).toEqual({ email: 'a@example.com' })
    expect(logs.filter((l) => l.includes('ACCESS_JWKS') && l.includes('production'))).toHaveLength(1)
  })
})

const unsigned = (header: Record<string, unknown>, claims: Record<string, unknown>, sig = '') =>
  `${b64url.encodeText(JSON.stringify(header))}.${b64url.encodeText(JSON.stringify(claims))}.${sig}`

describe('verifyAccessJwt algorithm', () => {
  it("refuses alg 'none' and 'HS256'", async () => {
    const k = await testKeys()
    const claims = { email: 'a@example.com', aud: ['aud-test'], iss: 'https://team.example.com', exp: Math.floor(Date.now() / 1000) + 3600 }
    expect(await verifyAccessJwt(unsigned({ alg: 'none', kid: 'test-kid' }, claims), opts(k.jwks))).toBeNull()
    expect(await verifyAccessJwt(unsigned({ alg: 'HS256', kid: 'test-kid' }, claims, 'c2ln'), opts(k.jwks))).toBeNull()
  })
  it('answers null, not a throw, when the keys cannot be fetched or imported', async () => {
    const k = await testKeys()
    const token = await k.token('a@example.com', env)
    const failing = { ...opts(k.jwks), keys: async () => { throw new Error('certs: 500') } }
    expect(await verifyAccessJwt(token, failing)).toBeNull()
    const bad = { ...opts(k.jwks), keys: async () => [{ kty: 'RSA', kid: 'test-kid', n: '!!', e: 'AQAB' } as JsonWebKey] }
    expect(await verifyAccessJwt(token, bad)).toBeNull()
  })
})

describe('accessKeys key rotation', () => {
  /** Team certs served from a fake fetch that counts calls; each test uses its own team domain (the cache is per isolate). */
  async function rotation(domain: string) {
    const old = await testKeys()
    const fresh = await testKeys()
    const freshJwk = { ...(JSON.parse(fresh.jwks) as { keys: JsonWebKey[] }).keys[0], kid: 'new-kid' }
    const oldJwk = (JSON.parse(old.jwks) as { keys: JsonWebKey[] }).keys[0]
    let served: JsonWebKey[] = [oldJwk!]
    let fetches = 0
    let clock = new Date('2026-10-05T12:00:00Z').getTime()
    const prodEnv = { APP_ORIGIN: 'https://review.wordado.com', ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: 'aud-test' } as unknown as Env
    const deps: Deps = {
      env: prodEnv,
      fetch: async () => {
        fetches++
        return new Response(JSON.stringify({ keys: served }), { status: 200 })
      },
      now: () => new Date(clock),
      log: () => undefined,
      sleep: async () => undefined,
    }
    const verify = (token: string) => verifyAccessJwt(token, { aud: 'aud-test', issuer: `https://${domain}`, keys: accessKeys(deps), now: new Date(clock) })
    const claims = { email: 'a@example.com', aud: ['aud-test'], iss: `https://${domain}`, exp: Math.floor(clock / 1000) + 3600 }
    return {
      old: () => old.token('a@example.com', prodEnv),
      fresh: () => fresh.sign(claims, 'new-kid'),
      bogus: () => fresh.sign(claims, 'bogus-kid'),
      rotate: () => { served = [oldJwk!, freshJwk] },
      tick: (ms: number) => { clock += ms },
      fetches: () => fetches,
      verify,
    }
  }

  it('refetches the certs once on an unknown kid and then accepts the new key', async () => {
    const r = await rotation('rotate1.example.com')
    expect(await r.verify(await r.old())).toEqual({ email: 'a@example.com' })
    expect(r.fetches()).toBe(1)
    r.rotate()
    r.tick(1_000)
    expect(await r.verify(await r.fresh())).toEqual({ email: 'a@example.com' })
    expect(r.fetches()).toBe(2)
    expect(await r.verify(await r.fresh())).toEqual({ email: 'a@example.com' })
    expect(r.fetches()).toBe(2)
  })

  it('refetches at most once a minute on unknown kids', async () => {
    const r = await rotation('rotate2.example.com')
    expect(await r.verify(await r.old())).toEqual({ email: 'a@example.com' })
    r.tick(1_000)
    expect(await r.verify(await r.bogus())).toBeNull()
    expect(r.fetches()).toBe(2)
    r.tick(1_000)
    expect(await r.verify(await r.bogus())).toBeNull()
    expect(r.fetches()).toBe(2)
    r.tick(60_000)
    expect(await r.verify(await r.bogus())).toBeNull()
    expect(r.fetches()).toBe(3)
  })

  it('answers null when the certs cannot be fetched', async () => {
    const k = await testKeys()
    const domain = 'down.example.com'
    const e = { APP_ORIGIN: 'https://review.wordado.com', ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: 'aud-test' } as unknown as Env
    const deps: Deps = { env: e, fetch: async () => new Response('down', { status: 502 }), now: () => new Date(), log: () => undefined, sleep: async () => undefined }
    expect(await verifyAccessJwt(await k.token('a@example.com', e), { aud: 'aud-test', issuer: `https://${domain}`, keys: accessKeys(deps), now: new Date() })).toBeNull()
  })
})

describe('accessKeys ACCESS_JWKS origins', () => {
  const run = async (origin: string) => {
    const secret = await testKeys()
    const logs: string[] = []
    const e = { APP_ORIGIN: origin, ACCESS_TEAM_DOMAIN: `jwks-${origin.length}.example.com`, ACCESS_AUD: 'aud-test', ACCESS_JWKS: secret.jwks } as unknown as Env
    const deps: Deps = { env: e, fetch: async () => new Response(JSON.stringify({ keys: [] }), { status: 200 }), now: () => new Date(), log: (l) => logs.push(l), sleep: async () => undefined }
    const who = await verifyAccessJwt(await secret.token('a@example.com', e), { aud: 'aud-test', issuer: `https://${e.ACCESS_TEAM_DOMAIN}`, keys: accessKeys(deps), now: new Date() })
    return who
  }
  it('honours ACCESS_JWKS on local and test origins only', async () => {
    expect(await run('http://127.0.0.1:4181')).toEqual({ email: 'a@example.com' })
    expect(await run('http://localhost:8787')).toEqual({ email: 'a@example.com' })
    expect(await run('https://review.test')).toEqual({ email: 'a@example.com' })
    expect(await run('https://staging.wordado.com')).toBeNull()
    expect(await run('https://review.test.evil.example.com')).toBeNull()
  })
})
