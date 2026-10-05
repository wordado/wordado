import { describe, expect, it } from 'vitest'
import { b64url } from './b64'
import { appJwt, GitHub, verifyWebhook } from './github'
import { FakeGitHub, testAppKey } from './test/fakeGitHub'

const now = new Date('2026-10-05T12:00:00Z')

describe('appJwt', () => {
  it('signs an RS256 JWT for the app, valid ten minutes at most', async () => {
    const { pem, publicKey } = await testAppKey()
    const jwt = await appJwt('123', pem, now)
    const [h, p, s] = jwt.split('.') as [string, string, string]
    expect(JSON.parse(b64url.decodeText(h))).toEqual({ alg: 'RS256', typ: 'JWT' })
    const claims = JSON.parse(b64url.decodeText(p)) as { iss: string; iat: number; exp: number }
    expect(claims.iss).toBe('123')
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600)
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, b64url.decode(s) as Uint8Array<ArrayBuffer>, new TextEncoder().encode(`${h}.${p}`))).toBe(true)
  })
  it('explains a PKCS#1 key', async () => {
    await expect(appJwt('1', '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----', now)).rejects.toThrow(/openssl pkcs8/)
  })
})

describe('GitHub', () => {
  const make = async (fake: FakeGitHub) => new GitHub({ api: 'https://api.github.test', appId: '1', installationId: '2', privateKeyPem: (await testAppKey()).pem, repo: fake.repo }, (i, init) => fake.fetch(i.replace('https://api.github.test', 'https://x'), init), () => now)

  it('reads a file at a commit, commits files on a new branch and opens a pull request', async () => {
    const fake = new FakeGitHub({ 'review/a.csv': 'old', 'review/b.csv': 'keep' })
    const gh = await make(fake)
    const head = await gh.headSha()
    expect(await gh.readText('review/a.csv', head)).toBe('old')
    expect(await gh.readText('review/none.csv', head)).toBeNull()
    const made = await gh.commitFiles({ parent: head, branch: 'review/x-1', message: 'm', author: { name: 'Анна', email: 'review@wordado.com' }, files: [{ path: 'review/a.csv', content: 'new' }] })
    expect('commit' in made).toBe(true)
    const commit = fake.commits.get(fake.branches.get('review/x-1')!)!
    expect(commit.files.get('review/a.csv')).toBe('new')
    expect(commit.files.get('review/b.csv')).toBe('keep')
    expect(commit.author.name).toBe('Анна')
    expect(await gh.commitFiles({ parent: head, branch: 'review/x-1', message: 'm', author: { name: 'A', email: 'e' }, files: [] })).toEqual({ exists: true })
    expect(await gh.openPr({ title: 't', head: 'review/x-1', body: 'b' })).toEqual({ number: 1, url: 'https://github.com/wordado/wordado-content/pull/1' })
    expect(await gh.prState(1)).toBe('open')
    fake.pulls[0]!.state = 'closed'
    fake.pulls[0]!.merged = true
    expect(await gh.prState(1)).toBe('merged')
  })
})

describe('verifyWebhook', () => {
  it('accepts GitHub’s sha256 HMAC and refuses anything else', async () => {
    const body = '{"action":"closed"}'
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('s3cret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(await verifyWebhook('s3cret', body, `sha256=${sig}`)).toBe(true)
    expect(await verifyWebhook('s3cret', body, `sha256=${'0'.repeat(64)}`)).toBe(false)
    expect(await verifyWebhook('s3cret', body, null)).toBe(false)
    expect(await verifyWebhook('', body, `sha256=${sig}`)).toBe(false)
  })
})
