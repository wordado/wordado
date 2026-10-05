import { b64url } from './b64'
import type { Deps } from './app'

export async function appJwt(appId: string, pem: string, now: Date): Promise<string> {
  if (pem.includes('BEGIN RSA PRIVATE KEY')) {
    throw new Error('GITHUB_APP_PRIVATE_KEY is a PKCS#1 key; convert it first: openssl pkcs8 -topk8 -nocrypt -in app.pem -out app-pkcs8.pem')
  }
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der as Uint8Array<ArrayBuffer>, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const iat = Math.floor(now.getTime() / 1000) - 60
  const head = b64url.encodeText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64url.encodeText(JSON.stringify({ iat, exp: iat + 540, iss: appId }))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${b64url.encode(new Uint8Array(sig))}`
}

const tokens = new Map<string, { token: string; expires: number }>()

/** Clears the cached installation tokens (tests only, so one test's token doesn't leak into the next). */
export function resetGitHubTokens(): void {
  tokens.clear()
}

export interface GitHubConfig { readonly api: string; readonly appId: string; readonly installationId: string; readonly privateKeyPem: string; readonly repo: string }

/** The few GitHub REST calls Submit needs, as the GitHub App installed on wordado-content (spec §7, §10). */
export class GitHub {
  constructor(private readonly cfg: GitHubConfig, private readonly fetchFn: Deps['fetch'], private readonly now: () => Date) {}

  private async token(): Promise<string> {
    const hit = tokens.get(this.cfg.installationId)
    if (hit && hit.expires - this.now().getTime() > 300_000) return hit.token
    const res = await this.fetchFn(`${this.cfg.api}/app/installations/${this.cfg.installationId}/access_tokens`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await appJwt(this.cfg.appId, this.cfg.privateKeyPem, this.now())}`, accept: 'application/vnd.github+json', 'user-agent': 'wordado-review' },
    })
    if (!res.ok) throw new Error(`GitHub installation token: ${res.status}`)
    const body = (await res.json()) as { token: string; expires_at: string }
    tokens.set(this.cfg.installationId, { token: body.token, expires: Date.parse(body.expires_at) })
    return body.token
  }

  private async call(method: string, path: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${await this.token()}`, accept, 'user-agent': 'wordado-review', 'x-github-api-version': '2022-11-28' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    return this.fetchFn(`${this.cfg.api}/repos/${this.cfg.repo}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  }

  private async json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) throw new Error(`GitHub ${what}: ${res.status}`)
    return (await res.json()) as T
  }

  async headSha(branch = 'main'): Promise<string> {
    return (await this.json<{ object: { sha: string } }>(await this.call('GET', `/git/ref/heads/${encodeURIComponent(branch)}`), 'ref')).object.sha
  }

  async readText(path: string, ref: string): Promise<string | null> {
    const res = await this.call('GET', `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, undefined, 'application/vnd.github.raw')
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GitHub contents ${path}: ${res.status}`)
    return res.text()
  }

  async commitFiles(o: { parent: string; branch: string; message: string; author: { name: string; email: string }; files: readonly { path: string; content: string }[] }): Promise<{ commit: string } | { exists: true }> {
    const base = await this.json<{ tree: { sha: string } }>(await this.call('GET', `/git/commits/${o.parent}`), 'commit')
    const tree = await this.json<{ sha: string }>(
      await this.call('POST', '/git/trees', { base_tree: base.tree.sha, tree: o.files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) }),
      'tree',
    )
    const commit = await this.json<{ sha: string }>(
      await this.call('POST', '/git/commits', { message: o.message, tree: tree.sha, parents: [o.parent], author: { ...o.author, date: this.now().toISOString() } }),
      'commit',
    )
    const ref = await this.call('POST', '/git/refs', { ref: `refs/heads/${o.branch}`, sha: commit.sha })
    if (ref.status === 422) return { exists: true }
    await this.json(ref, 'ref create')
    return { commit: commit.sha }
  }

  async openPr(o: { title: string; head: string; body: string }): Promise<{ number: number; url: string }> {
    const pr = await this.json<{ number: number; html_url: string }>(await this.call('POST', '/pulls', { ...o, base: 'main' }), 'pull request')
    return { number: pr.number, url: pr.html_url }
  }

  async prState(n: number): Promise<'open' | 'merged' | 'closed'> {
    const pr = await this.json<{ state: string; merged: boolean }>(await this.call('GET', `/pulls/${n}`), 'pull request')
    return pr.merged ? 'merged' : pr.state === 'open' ? 'open' : 'closed'
  }
}

export function githubFor(deps: Deps): GitHub | null {
  const e = deps.env
  if (!e.GITHUB_APP_PRIVATE_KEY || !e.GITHUB_APP_ID || !e.GITHUB_INSTALLATION_ID) return null
  return new GitHub({ api: e.GITHUB_API_URL ?? 'https://api.github.com', appId: e.GITHUB_APP_ID, installationId: e.GITHUB_INSTALLATION_ID, privateKeyPem: e.GITHUB_APP_PRIVATE_KEY, repo: e.CONTENT_REPO }, deps.fetch, deps.now)
}

/** GitHub's X-Hub-Signature-256 (spec §7.4). */
export async function verifyWebhook(secret: string, body: string, signature: string | null): Promise<boolean> {
  if (!secret || !signature?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const want = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const got = signature.slice('sha256='.length)
  if (got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i += 1) diff |= want.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}
