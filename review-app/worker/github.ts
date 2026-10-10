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

const DETAIL_MAX = 300
/** Files asked for in one GraphQL request. */
const READ_BATCH = 40

/**
 * A GitHub call that failed: `what` names the call, `status` is the HTTP status (0 when GitHub could not be
 * reached), `detail` is GitHub's own explanation from the response body, and `retryAfter` its retry-after header
 * in seconds. Nothing of the request (headers, token) is in it.
 */
export class GitHubError extends Error {
  constructor(readonly what: string, readonly status: number, readonly detail: string, readonly retryAfter: number | null = null) {
    super(`GitHub ${what}: ${status}${detail ? ` (${detail})` : ''}`)
    this.name = 'GitHubError'
  }
}

/** GitHub's explanation in an error body: its `message` and the `errors[]` messages or codes; else the text, unless it is a page. */
function detailOf(text: string): string {
  let detail = text.trimStart().startsWith('<') ? '' : text
  try {
    const body = JSON.parse(text) as { message?: unknown; errors?: unknown }
    const errors = (Array.isArray(body.errors) ? body.errors : []).map((e: unknown) => (typeof e === 'string' ? e : String((e as { message?: unknown; code?: unknown } | null)?.message ?? (e as { code?: unknown } | null)?.code ?? ''))).filter(Boolean)
    detail = [typeof body.message === 'string' ? body.message : '', errors.join('; ')].filter(Boolean).join(': ')
  } catch {
    // Not JSON: the text as it is.
  }
  return detail.replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX)
}

async function failure(res: Response, what: string): Promise<GitHubError> {
  const after = Number(res.headers.get('retry-after') ?? '')
  return new GitHubError(what, res.status, detailOf(await res.text().catch(() => '')), res.headers.has('retry-after') && Number.isFinite(after) ? after : null)
}

/** The few GitHub REST calls Submit needs, as the GitHub App installed on wordado-content (spec §7, §10). */
export class GitHub {
  constructor(private readonly cfg: GitHubConfig, private readonly fetchFn: Deps['fetch'], private readonly now: () => Date) {}

  private async send(what: string, url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, init)
    } catch (err) {
      throw new GitHubError(what, 0, (err instanceof Error ? err.message : String(err)).slice(0, DETAIL_MAX))
    }
  }

  private async token(): Promise<string> {
    const hit = tokens.get(this.cfg.installationId)
    if (hit && hit.expires - this.now().getTime() > 300_000) return hit.token
    const res = await this.send('installation token', `${this.cfg.api}/app/installations/${this.cfg.installationId}/access_tokens`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await appJwt(this.cfg.appId, this.cfg.privateKeyPem, this.now())}`, accept: 'application/vnd.github+json', 'user-agent': 'wordado-review' },
    })
    if (!res.ok) throw await failure(res, 'installation token')
    const body = (await res.json()) as { token: string; expires_at: string }
    tokens.set(this.cfg.installationId, { token: body.token, expires: Date.parse(body.expires_at) })
    return body.token
  }

  private async call(what: string, method: string, path: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${await this.token()}`, accept, 'user-agent': 'wordado-review', 'x-github-api-version': '2022-11-28' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    return this.send(what, `${this.cfg.api}/repos/${this.cfg.repo}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  }

  private async json<T>(what: string, method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.call(what, method, path, body)
    if (!res.ok) throw await failure(res, what)
    return (await res.json()) as T
  }

  async headSha(branch = 'main'): Promise<string> {
    return (await this.json<{ object: { sha: string } }>('ref', 'GET', `/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha
  }

  async readText(path: string, ref: string): Promise<string | null> {
    const res = await this.call(`contents ${path}`, 'GET', `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, undefined, 'application/vnd.github.raw')
    if (res.status === 404) return null
    if (!res.ok) throw await failure(res, `contents ${path}`)
    return res.text()
  }

  /**
   * Many files at one commit, in one request per READ_BATCH of them: a submit of a spot check reads files from
   * all over a queue, and a Worker may make only so many requests while it answers one. Null for a file that is
   * not there. A file GitHub does not return whole here is read by itself.
   */
  async readTexts(paths: readonly string[], ref: string): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>()
    const [owner = '', name = ''] = this.cfg.repo.split('/')
    for (let at = 0; at < paths.length; at += READ_BATCH) {
      const batch = paths.slice(at, at + READ_BATCH)
      const query = `query($owner: String!, $name: String!${batch.map((_, i) => `, $e${i}: String!`).join('')}) { repository(owner: $owner, name: $name) {${batch.map((_, i) => ` f${i}: object(expression: $e${i}) { __typename ... on Blob { text isTruncated } }`).join('')} } }`
      const variables: Record<string, string> = { owner, name }
      batch.forEach((path, i) => (variables[`e${i}`] = `${ref}:${path}`))
      const headers = { authorization: `Bearer ${await this.token()}`, accept: 'application/vnd.github+json', 'user-agent': 'wordado-review', 'content-type': 'application/json' }
      const res = await this.send('files', `${this.cfg.api}/graphql`, { method: 'POST', headers, body: JSON.stringify({ query, variables }) })
      if (!res.ok) throw await failure(res, 'files')
      const body = (await res.json()) as { data?: { repository?: Record<string, { __typename: string; text?: string | null; isTruncated?: boolean } | null> | null } | null; errors?: { message?: string }[] }
      const found = body.data?.repository
      if (!found) throw new GitHubError('files', res.status, (body.errors ?? []).map((e) => e.message ?? '').filter(Boolean).join('; ').slice(0, DETAIL_MAX))
      for (const [i, path] of batch.entries()) {
        const f = found[`f${i}`]
        if (f == null) out.set(path, null)
        else if (f.__typename === 'Blob' && typeof f.text === 'string' && f.isTruncated === false) out.set(path, f.text)
        else out.set(path, await this.readText(path, ref))
      }
    }
    return out
  }

  /** The tree of `parent` with these files replaced. The same content gives the same sha, whoever writes it. */
  async writeTree(parent: string, files: readonly { path: string; content: string }[]): Promise<string> {
    const base = await this.commitOf(parent)
    return (await this.json<{ sha: string }>('tree', 'POST', '/git/trees', { base_tree: base.tree, tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) })).sha
  }

  async commitOf(sha: string): Promise<{ tree: string; parents: string[]; message: string }> {
    const c = await this.json<{ tree: { sha: string }; parents: { sha: string }[]; message: string }>('commit', 'GET', `/git/commits/${sha}`)
    return { tree: c.tree.sha, parents: c.parents.map((p) => p.sha), message: c.message }
  }

  /** The branches whose name starts with `prefix`, each with its head commit. */
  async branches(prefix: string): Promise<{ name: string; sha: string }[]> {
    const refs = await this.json<{ ref: string; object: { sha: string } }[]>('branches', 'GET', `/git/matching-refs/heads/${prefix.split('/').map(encodeURIComponent).join('/')}?per_page=100`)
    return refs.map((r) => ({ name: r.ref.replace(/^refs\/heads\//, ''), sha: r.object.sha }))
  }

  /** One commit of `files` on `parent` as a new branch; `tree` when writeTree was already called for them. */
  async commitFiles(o: { parent: string; branch: string; message: string; author: { name: string; email: string }; files: readonly { path: string; content: string }[]; tree?: string }): Promise<{ commit: string } | { exists: true }> {
    const tree = o.tree ?? (await this.writeTree(o.parent, o.files))
    const commit = await this.json<{ sha: string }>('commit', 'POST', '/git/commits', { message: o.message, tree, parents: [o.parent], author: { ...o.author, date: this.now().toISOString() } })
    const ref = await this.call('ref create', 'POST', '/git/refs', { ref: `refs/heads/${o.branch}`, sha: commit.sha })
    if (ref.status === 422) return { exists: true }
    if (!ref.ok) throw await failure(ref, 'ref create')
    return { commit: commit.sha }
  }

  async openPr(o: { title: string; head: string; body: string }): Promise<{ number: number; url: string }> {
    const pr = await this.json<{ number: number; html_url: string }>('pull request', 'POST', '/pulls', { ...o, base: 'main' })
    return { number: pr.number, url: pr.html_url }
  }

  /** The pull request opened from a branch, whatever its state; null when there is none. */
  async findPr(branch: string): Promise<{ number: number; url: string } | null> {
    const owner = this.cfg.repo.split('/')[0] ?? ''
    const list = await this.json<{ number: number; html_url: string }[]>('pull requests', 'GET', `/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all`)
    const pr = list[0]
    return pr ? { number: pr.number, url: pr.html_url } : null
  }

  async prState(n: number): Promise<'open' | 'merged' | 'closed'> {
    const pr = await this.json<{ state: string; merged: boolean }>('pull request state', 'GET', `/pulls/${n}`)
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
