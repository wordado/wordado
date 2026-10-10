import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { b64url } from './b64'
import { forgetGoogleToken, GOOGLE_TOKEN_URL, googleToken, TOKEN_MARGIN_S } from './googleToken'
import { FakeModel, testServiceAccount, type TestServiceAccount } from './test/fakeModel'
import { fetchBy } from './test/platform'

let account: TestServiceAccount
let google: FakeModel
let now: Date
let inits: (RequestInit | undefined)[]

beforeAll(async () => {
  account = await testServiceAccount()
})
beforeEach(() => {
  forgetGoogleToken()
  google = new FakeModel('unused')
  google.serviceAccount = account
  now = new Date('2026-10-05T12:00:00Z')
  inits = []
})

const deps = () => ({ fetch: fetchBy({ 'https://oauth2.googleapis.com': async (input, init) => (inits.push(init), google.fetch(input, init)) }), now: () => now })
const signal = () => AbortSignal.timeout(5_000)
const ask = (keyFile = account.keyFile, standIn = false) => googleToken(deps(), keyFile, { standIn, signal: signal() })
const later = (seconds: number) => void (now = new Date(now.getTime() + seconds * 1000))

describe('googleToken', () => {
  it('signs a JWT with the account’s key and changes it for a token at Google’s token endpoint', async () => {
    expect(GOOGLE_TOKEN_URL).toBe('https://oauth2.googleapis.com/token')
    expect(await ask()).toEqual({ ok: true, token: 'ya29.fake-1', projectId: 'a-project' })
    expect(google.tokenRequests).toHaveLength(1)
    const sent = google.tokenRequests[0]!
    expect(sent.url).toBe('https://oauth2.googleapis.com/token')
    expect(sent.method).toBe('POST')
    expect(sent.headers).toEqual({ 'content-type': 'application/x-www-form-urlencoded' })
    expect(Object.keys(sent.form).sort()).toEqual(['assertion', 'grant_type'])
    expect(sent.form['grant_type']).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    expect(sent.header).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'a-key-id' })
    const iat = Math.floor(now.getTime() / 1000)
    expect(sent.claims).toEqual({ iss: account.email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 })
    // A redirect is not followed, and the request ends with the time it was given.
    expect(inits[0]?.redirect).toBe('manual')
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('names the key in the JWT’s header when the key file names it, and not otherwise', async () => {
    for (const [id, header] of [['k-2', { alg: 'RS256', typ: 'JWT', kid: 'k-2' }], [undefined, { alg: 'RS256', typ: 'JWT' }], ['', { alg: 'RS256', typ: 'JWT' }], [7, { alg: 'RS256', typ: 'JWT' }]] as const) {
      forgetGoogleToken()
      const other = await testServiceAccount({ private_key_id: id })
      google.serviceAccount = other
      expect((await ask(other.keyFile)).ok).toBe(true)
      expect(google.tokenRequests.at(-1)!.header).toEqual(header)
      expect(google.tokenRequests.at(-1)!.signed).toBe(true)
    }
  })

  it('gives the key file’s project when the address needs it, and refuses a key file without one before asking anybody', async () => {
    const project = async (id: unknown, kept = false) => {
      if (!kept) forgetGoogleToken()
      const other = await testServiceAccount({ project_id: id })
      google.serviceAccount = other
      return googleToken(deps(), other.keyFile, { standIn: false, needsProject: true, signal: signal() })
    }
    for (const good of ['a-project', 'abc123', 'wordado-feedback-ai-0123456789']) expect(await project(good)).toMatchObject({ ok: true, projectId: good })
    const asked = google.tokenRequests.length
    expect(await project(undefined)).toEqual({ ok: false, why: 'refused', detail: 'key file: no project_id' })
    for (const bad of ['', 7, null, 'short', 'a'.repeat(31), 'A-project', '1-project', 'a-project-', 'a_project', 'a project', 'a/project', '../other', 'example.com:project', 'a-project?x=1', '{project}']) {
      expect(await project(bad)).toEqual({ ok: false, why: 'refused', detail: bad === '' || typeof bad !== 'string' ? 'key file: no project_id' : 'key file: project_id' })
    }
    expect(google.tokenRequests).toHaveLength(asked)
    // A key file with no project is good where the address needs none, and its token is kept; needed later, it is still refused.
    const none = await testServiceAccount({ project_id: undefined })
    google.serviceAccount = none
    forgetGoogleToken()
    expect(await googleToken(deps(), none.keyFile, { standIn: false, signal: signal() })).toEqual({ ok: true, token: `ya29.fake-${asked + 1}`, projectId: null })
    expect(await googleToken(deps(), none.keyFile, { standIn: false, needsProject: true, signal: signal() })).toEqual({ ok: false, why: 'refused', detail: 'key file: no project_id' })
    expect(google.tokenRequests).toHaveLength(asked + 1)
  })

  it('signs with RS256: the signature is good for the key’s public half, over the header and the claims as they were sent', async () => {
    await ask()
    const [head, body, sig] = google.tokenRequests[0]!.form['assertion']!.split('.') as [string, string, string]
    const data = new TextEncoder().encode(`${head}.${body}`)
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', account.publicKey, b64url.decode(sig) as Uint8Array<ArrayBuffer>, data)).toBe(true)
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', (await testServiceAccount()).publicKey, b64url.decode(sig) as Uint8Array<ArrayBuffer>, data)).toBe(false)
    expect(google.tokenRequests[0]!.signed).toBe(true)
  })

  it('keeps the token in memory: a second read asks nobody', async () => {
    expect(await ask()).toMatchObject({ ok: true, token: 'ya29.fake-1' })
    later(60)
    expect(await ask()).toMatchObject({ ok: true, token: 'ya29.fake-1' })
    later(3600 - 60 - TOKEN_MARGIN_S - 1)
    expect(await ask()).toMatchObject({ ok: true, token: 'ya29.fake-1' })
    expect(google.tokenRequests).toHaveLength(1)
  })

  it('makes a new token shortly before the old one ends', async () => {
    expect(TOKEN_MARGIN_S).toBe(300)
    await ask()
    later(3600 - TOKEN_MARGIN_S)
    expect(await ask()).toMatchObject({ ok: true, token: 'ya29.fake-2' })
    expect(google.tokenRequests).toHaveLength(2)
    expect(google.tokenRequests[1]!.claims['iat']).toBe(Math.floor(now.getTime() / 1000))
    // Its life is the one the endpoint said, not an hour taken for granted.
    google.expiresIn = 600
    later(3600)
    expect(await ask()).toMatchObject({ ok: true, token: 'ya29.fake-3' })
    later(299)
    expect((await ask()).ok && google.tokenRequests.length).toBe(3)
    later(1)
    expect(await ask()).toMatchObject({ ok: true, token: 'ya29.fake-4' })
  })

  it('keeps a token for the key file it was made from, and forgets it when told to', async () => {
    await ask()
    const other = await testServiceAccount()
    google.serviceAccount = other
    expect(await ask(other.keyFile)).toMatchObject({ ok: true, token: 'ya29.fake-2' })
    forgetGoogleToken()
    expect(await ask(other.keyFile)).toMatchObject({ ok: true, token: 'ya29.fake-3' })
  })

  it('refuses a key file that cannot be used, says which part, and asks nobody', async () => {
    const file = (over: Record<string, unknown>) => JSON.stringify({ ...(JSON.parse(account.keyFile) as Record<string, unknown>), ...over })
    for (const [bad, detail] of [
      ['not json', 'key file: not JSON'],
      ['"a string"', 'key file: not JSON'],
      ['null', 'key file: not JSON'],
      ['[]', 'key file: no client_email'],
      [file({ client_email: undefined }), 'key file: no client_email'],
      [file({ client_email: 7 }), 'key file: no client_email'],
      [file({ client_email: ' ' }), 'key file: no client_email'],
      [file({ private_key: undefined }), 'key file: no private_key'],
      [file({ private_key: '' }), 'key file: no private_key'],
      [file({ private_key: 'not a key' }), 'key file: private_key'],
      [file({ private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n' }), 'key file: private_key'],
      [file({ private_key: account.privateKeyPem.replace('BEGIN PRIVATE KEY', 'BEGIN RSA PRIVATE KEY') }), 'key file: private_key'],
      [file({ token_uri: 7 }), 'key file: token_uri'],
    ] as const) {
      expect(await ask(bad)).toEqual({ ok: false, why: 'refused', detail })
    }
    expect(google.tokenRequests).toEqual([])
  })

  it('takes a key file with no token_uri: the endpoint is Google’s', async () => {
    const { keyFile } = await testServiceAccount({ token_uri: undefined })
    google.serviceAccount = { email: account.email, publicKey: (await testServiceAccount()).publicKey }
    // (Another key: the endpoint was asked, and refused the signature.)
    expect(await ask(keyFile)).toEqual({ ok: false, why: 'refused', detail: 'token: 400' })
    expect(google.tokenRequests.map((r) => r.url)).toEqual(['https://oauth2.googleapis.com/token'])
  })

  it('sends the signed JWT to no address but Google’s, whatever the key file names', async () => {
    const elsewhere = new FakeModel('unused')
    elsewhere.serviceAccount = account
    const fetch = fetchBy({ 'https://oauth2.googleapis.com': google.fetch, 'https://oauth2.googleapis.com.example.com': elsewhere.fetch, 'https://example.com': elsewhere.fetch, 'http://127.0.0.1:4184': elsewhere.fetch })
    const file = (uri: string) => JSON.stringify({ ...(JSON.parse(account.keyFile) as Record<string, unknown>), token_uri: uri })
    for (const uri of ['https://example.com/token', 'https://oauth2.googleapis.com.example.com/token', 'https://oauth2.googleapis.com/token?x=1', 'https://oauth2.googleapis.com/token/', 'http://oauth2.googleapis.com/token', 'http://127.0.0.1:4184/token', '']) {
      expect(await googleToken({ fetch, now: () => now }, file(uri), { standIn: false, signal: signal() })).toEqual({ ok: false, why: 'refused', detail: 'key file: token_uri' })
    }
    expect(elsewhere.tokenRequests).toEqual([])
    expect(google.tokenRequests).toEqual([])
  })

  it('takes a token address on this machine for a stand-in, and only there', async () => {
    const standIn = new FakeModel('unused')
    standIn.serviceAccount = account
    const fetch = fetchBy({ 'http://127.0.0.1:4184': standIn.fetch, 'http://localhost:4184': standIn.fetch, 'https://example.com': standIn.fetch })
    const file = (uri: string) => JSON.stringify({ ...(JSON.parse(account.keyFile) as Record<string, unknown>), token_uri: uri })
    expect(await googleToken({ fetch, now: () => now }, file('http://127.0.0.1:4184/token'), { standIn: true, signal: signal() })).toMatchObject({ ok: true, token: 'ya29.fake-1' })
    // The JWT is made for the endpoint it goes to.
    expect(standIn.tokenRequests[0]!.claims['aud']).toBe('http://127.0.0.1:4184/token')
    forgetGoogleToken()
    expect((await googleToken({ fetch, now: () => now }, file('http://localhost:4184/token'), { standIn: true, signal: signal() })).ok).toBe(true)
    for (const uri of ['https://example.com/token', 'http://example.com/token', 'http://127.0.0.1.example.com/token', 'ftp://127.0.0.1/token']) {
      forgetGoogleToken()
      expect(await googleToken({ fetch, now: () => now }, file(uri), { standIn: true, signal: signal() })).toEqual({ ok: false, why: 'refused', detail: 'key file: token_uri' })
    }
    expect(standIn.tokenRequests).toHaveLength(2)
  })

  it('says refused, unreachable or late as the token endpoint answers, with its status, and keeps no token', async () => {
    for (const [status, why] of [[400, 'refused'], [401, 'refused'], [403, 'refused'], [302, 'refused'], [204, 'refused'], [429, 'unreachable'], [500, 'unreachable'], [503, 'unreachable']] as const) {
      google.tokenFailure = { status }
      expect(await ask()).toEqual({ ok: false, why, detail: `token: ${status}` })
    }
    google.tokenFailure = 'late'
    expect(await ask()).toEqual({ ok: false, why: 'late', detail: 'token: TimeoutError' })
    google.tokenFailure = new TypeError('connect failed')
    expect(await ask()).toEqual({ ok: false, why: 'unreachable', detail: 'token: TypeError' })
    expect(google.tokenRequests).toHaveLength(10)
    // Nothing of a failure was kept: the next read asks again, and gets a token.
    google.tokenFailure = null
    expect(await ask()).toMatchObject({ ok: true, token: 'ya29.fake-1' })
  })

  it('says unfit to an answer that holds no token it can use, and keeps none', async () => {
    for (const body of ['<html>', '', 'null', '{}', '{"access_token":7,"expires_in":3600}', '{"access_token":"","expires_in":3600}', '{"access_token":"t"}', '{"access_token":"t","expires_in":"3600"}', '{"access_token":"t","expires_in":0}', '{"access_token":"a b","expires_in":3600}', '{"access_token":"a\\nb","expires_in":3600}']) {
      google.tokenFailure = { status: 200, body }
      const got = await ask()
      expect(got).toMatchObject({ ok: false, why: 'unfit' })
      expect((got as { detail: string }).detail).toMatch(/^token: (not JSON|no access_token)$/)
    }
    expect(google.tokenRequests).toHaveLength(11)
  })

  it('gives up with the time it was given', async () => {
    const never = (_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason as Error)))
    expect(await googleToken({ fetch: never, now: () => now }, account.keyFile, { standIn: false, signal: AbortSignal.timeout(40) })).toEqual({ ok: false, why: 'late', detail: 'token: TimeoutError' })
  })

  it('says nothing of the key, the JWT or the token in what it gives back of a failure', async () => {
    const details: string[] = []
    const keep = async (keyFile = account.keyFile) => {
      const got = await ask(keyFile)
      if (!got.ok) details.push(got.detail)
    }
    // The endpoint echoes what it was sent, as an error body may.
    google.tokenFailure = { status: 400 }
    await keep()
    google.tokenFailure = { status: 200, body: `not json ${account.privateKeyPem}` }
    await keep()
    const named = new Error(account.privateKeyPem)
    named.name = account.privateKeyPem
    google.tokenFailure = named
    await keep()
    await keep(account.keyFile.slice(0, -1))
    await keep(JSON.stringify({ client_email: account.email, private_key: `${account.privateKeyPem}x` }))
    expect(details).toEqual(['token: 400', 'token: not JSON', 'token: error', 'key file: not JSON', 'key file: private_key'])
    const jwt = google.tokenRequests[0]!.form['assertion']!
    for (const detail of details) for (const secret of [account.email, jwt, jwt.split('.')[2]!, 'PRIVATE KEY', 'ya29']) expect(detail).not.toContain(secret)
  })
})
