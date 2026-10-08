import { describe, expect, it } from 'vitest'
import { b64url } from './b64'
import { appJwt, GitHub, GitHubError, resetGitHubTokens, verifyWebhook } from './github'
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

  it('writes the same tree for the same content, and lists the branches of a name with their commits', async () => {
    const fake = new FakeGitHub({ 'review/a.csv': 'old' })
    const gh = await make(fake)
    const head = await gh.headSha()
    const files = [{ path: 'review/a.csv', content: 'new' }]
    const tree = await gh.writeTree(head, files)
    expect(await gh.writeTree(head, files)).toBe(tree)
    expect(await gh.writeTree(head, [{ path: 'review/a.csv', content: 'other' }])).not.toBe(tree)
    await gh.commitFiles({ parent: head, branch: 'review/x-1', message: 'm', author: { name: 'A', email: 'review@wordado.com' }, files, tree })
    fake.branches.set('review/xy-1', head)
    const found = await gh.branches('review/x-')
    expect(found.map((b) => b.name)).toEqual(['review/x-1'])
    expect(await gh.commitOf(found[0]!.sha)).toEqual({ tree, parents: [head], message: 'm' })
  })

  describe('a failed call', () => {
    const failing = async (res: () => Response | Promise<Response>) => {
      resetGitHubTokens()
      const fake = new FakeGitHub({})
      return new GitHub({ api: 'https://api.github.test', appId: '1', installationId: '2', privateKeyPem: (await testAppKey()).pem, repo: fake.repo }, async (i, init) => (i.endsWith('/pulls') ? res() : fake.fetch(i.replace('https://api.github.test', 'https://x'), init)), () => now)
    }
    const caught = async (gh: GitHub) => gh.openPr({ title: 't', head: 'b', body: '' }).then(() => { throw new Error('did not fail') }, (err: unknown) => err as GitHubError)

    it('carries the status and GitHub’s message, with the errors’ messages and codes', async () => {
      const gh = await failing(() => new Response(JSON.stringify({ message: 'Validation Failed', errors: [{ resource: 'PullRequest', code: 'custom', message: 'No commits between main and b' }, { code: 'invalid' }], documentation_url: 'https://docs.github.com/rest' }), { status: 422 }))
      const err = await caught(gh)
      expect(err).toBeInstanceOf(GitHubError)
      expect(err).toMatchObject({ what: 'pull request', status: 422, detail: 'Validation Failed: No commits between main and b; invalid', retryAfter: null })
      expect(err.message).toBe('GitHub pull request: 422 (Validation Failed: No commits between main and b; invalid)')
    })
    it('caps a long message, and never names the token', async () => {
      const err = await caught(await failing(() => new Response(JSON.stringify({ message: 'x'.repeat(2000) }), { status: 403, headers: { 'retry-after': '3' } })))
      expect(err.detail.length).toBeLessThanOrEqual(300)
      expect(err.retryAfter).toBe(3)
      expect(err.message).not.toContain('inst-token')
    })
    it('falls back to the text of a body that is not JSON, and to nothing for a page', async () => {
      expect((await caught(await failing(() => new Response('  upstream\n  timed out ', { status: 504 })))).detail).toBe('upstream timed out')
      expect((await caught(await failing(() => new Response('<!DOCTYPE html><html><body>Unicorn</body></html>', { status: 502 })))).detail).toBe('')
    })
    it('is status 0 when GitHub could not be reached', async () => {
      const err = await caught(await failing(() => { throw new TypeError('fetch failed') }))
      expect(err).toMatchObject({ what: 'pull request', status: 0, detail: 'fetch failed' })
    })
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
