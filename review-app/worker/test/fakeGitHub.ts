import { b64url } from '../b64'

type Commit = { tree: string; parents: string[]; message: string; author: { name: string; email: string }; files: Map<string, string> }

/** The GitHub REST endpoints the Worker uses, in memory (spec §13). `files` is main's content. */
export class FakeGitHub {
  readonly files: Map<string, string>
  readonly branches = new Map<string, string>()
  readonly commits = new Map<string, Commit>()
  readonly trees = new Map<string, Map<string, string>>()
  readonly pulls: { number: number; title: string; head: string; body: string; state: 'open' | 'closed'; merged: boolean }[] = []
  private n = 0
  constructor(files: Record<string, string>, readonly repo = 'wordado/wordado-content') {
    this.files = new Map(Object.entries(files))
    this.trees.set('tree-main', new Map(this.files))
    this.commits.set('sha-main', { tree: 'tree-main', parents: [], message: 'main', author: { name: 'x', email: 'x' }, files: new Map(this.files) })
    this.branches.set('main', 'sha-main')
  }
  get mainSha(): string {
    return this.branches.get('main')!
  }
  /** Replaces a file on main with a new commit, as a merged pull request would. */
  pushToMain(path: string, content: string): void {
    const files = new Map(this.commits.get(this.mainSha)!.files)
    files.set(path, content)
    this.files.set(path, content)
    const sha = `sha-${++this.n}`
    this.commits.set(sha, { tree: `tree-${sha}`, parents: [this.mainSha], message: 'push', author: { name: 'x', email: 'x' }, files })
    this.branches.set('main', sha)
  }
  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input)
    const method = init.method ?? 'GET'
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    const p = url.pathname
    const repo = `/repos/${this.repo}`
    if (method === 'POST' && /^\/app\/installations\/\d+\/access_tokens$/.test(p)) return json({ token: 'inst-token', expires_at: '2099-01-01T00:00:00Z' }, 201)
    if (!(init.headers as Record<string, string> | undefined)?.['authorization']?.startsWith('Bearer ')) return json({ message: 'no auth' }, 401)
    let m: RegExpExecArray | null
    if (method === 'GET' && (m = new RegExp(`^${repo}/git/ref/heads/(.+)$`).exec(p))) {
      const sha = this.branches.get(decodeURIComponent(m[1]!))
      return sha ? json({ object: { sha } }) : json({ message: 'Not Found' }, 404)
    }
    if (method === 'GET' && (m = new RegExp(`^${repo}/contents/(.+)$`).exec(p))) {
      const ref = url.searchParams.get('ref') ?? this.mainSha
      const text = this.commits.get(ref)?.files.get(decodeURIComponent(m[1]!))
      return text === undefined ? json({ message: 'Not Found' }, 404) : new Response(text)
    }
    if (method === 'GET' && (m = new RegExp(`^${repo}/git/commits/(.+)$`).exec(p))) {
      const c = this.commits.get(m[1]!)
      return c ? json({ sha: m[1], tree: { sha: c.tree } }) : json({ message: 'Not Found' }, 404)
    }
    if (method === 'POST' && p === `${repo}/git/trees`) {
      const base = [...this.commits.values()].find((c) => c.tree === body['base_tree'])
      const files = new Map(base?.files ?? [])
      for (const e of body['tree'] as { path: string; content: string }[]) files.set(e.path, e.content)
      const sha = `tree-${++this.n}`
      this.trees.set(sha, files)
      return json({ sha }, 201)
    }
    if (method === 'POST' && p === `${repo}/git/commits`) {
      const sha = `sha-${++this.n}`
      this.commits.set(sha, { tree: String(body['tree']), parents: body['parents'] as string[], message: String(body['message']), author: body['author'] as Commit['author'], files: this.trees.get(String(body['tree']))! })
      return json({ sha }, 201)
    }
    if (method === 'POST' && p === `${repo}/git/refs`) {
      const branch = String(body['ref']).replace(/^refs\/heads\//, '')
      if (this.branches.has(branch)) return json({ message: 'Reference already exists' }, 422)
      this.branches.set(branch, String(body['sha']))
      return json({ ref: body['ref'] }, 201)
    }
    if (method === 'POST' && p === `${repo}/pulls`) {
      const number = this.pulls.length + 1
      this.pulls.push({ number, title: String(body['title']), head: String(body['head']), body: String(body['body']), state: 'open', merged: false })
      return json({ number, html_url: `https://github.com/${this.repo}/pull/${number}` }, 201)
    }
    if (method === 'GET' && p === `${repo}/pulls`) {
      const head = (url.searchParams.get('head') ?? '').split(':')[1] ?? ''
      return json(this.pulls.filter((x) => x.head === head).map((x) => ({ number: x.number, html_url: `https://github.com/${this.repo}/pull/${x.number}` })))
    }
    if (method === 'GET' && (m = new RegExp(`^${repo}/pulls/(\\d+)$`).exec(p))) {
      const pr = this.pulls.find((x) => x.number === Number(m![1]))
      return pr ? json({ number: pr.number, state: pr.state, merged: pr.merged }) : json({ message: 'Not Found' }, 404)
    }
    return json({ message: `fake GitHub has no ${method} ${p}` }, 404)
  }
}

export async function pkcs8Pem(key: CryptoKey): Promise<string> {
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', key))
  const b64 = btoa(String.fromCharCode(...der))
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`
}

export async function testAppKey(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  return { pem: await pkcs8Pem(pair.privateKey), publicKey: pair.publicKey }
}

export { b64url }
