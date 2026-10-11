import type { FeedbackItem, FeedbackPage } from '@wordado/core'
import type { AccountSweep } from '../../shared/hosted'

/** A message with every field filled in; `over` names what a test cares about. */
export function feedbackItem(id: number, over: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id,
    receivedAt: Date.parse('2026-10-05T09:00:00Z') + id * 60_000,
    kind: 'bug',
    message: `message ${id}`,
    contactEmail: '',
    signedIn: false,
    appVersion: 'B3kq9xZa',
    corpusVersion: 'bg 6',
    language: 'bg',
    screen: '/path',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    ...over,
  }
}

/** The learner app server's `GET /v1/admin/feedback`, in memory (spec §13): the token, the pages and the `kind`, `since` and `ids` filters as the real route has them.
 * With a `writeToken` it has that server's `/v1/admin/accounts/*` too (#187), which answer to that token alone. */
export class FakeLearnerApp {
  /** Every request made, as `METHOD path?query`. */
  readonly requests: string[] = []
  /** Set, every request gets this instead: a status with a body, or an error thrown as when the server is not reached. */
  failure: { status: number; body: string } | Error | null = null
  /** False: a server from before `ids`, which ignores the parameter and gives its newest page. */
  knowsIds = true
  /** What the accounts routes answer to; null, they are routes that do not exist. */
  writeToken: string | null = null
  /** The accounts, by address in small letters: when each was made and last signed in. */
  readonly accounts = new Map<string, { createdAt: number; lastSignInAt: number | null }>()
  /** Addresses two accounts answer to: asked about one, the server answers 409. */
  readonly ambiguous = new Set<string>()
  /** What the sweep's counts are. */
  sweep: AccountSweep = { months: 24, batch: 50, due: 0, undated: 0, taken: 0, lastRunAt: null, lastTaken: 0 }
  /** The bodies the accounts routes were sent, in order. */
  readonly bodies: unknown[] = []
  constructor(readonly token: string, public items: FeedbackItem[] = []) {}

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input)
    const method = init.method ?? 'GET'
    this.requests.push(`${method} ${url.pathname}${url.search}`)
    if (this.failure instanceof Error) throw this.failure
    if (this.failure) return new Response(this.failure.body, { status: this.failure.status })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    const authorization = new Headers(init.headers).get('authorization')
    if (url.pathname.startsWith('/v1/admin/accounts/')) {
      if (this.writeToken === null || authorization !== `Bearer ${this.writeToken}`) return json({ error: 'not_found' }, 404)
      const what = url.pathname.slice('/v1/admin/accounts/'.length)
      if (method === 'GET' && what === 'sweep') return json(this.sweep)
      if (method !== 'POST' || (what !== 'lookup' && what !== 'delete') || !(new Headers(init.headers).get('content-type') ?? '').startsWith('application/json')) return json({ error: 'not_found' }, 404)
      const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as { email?: unknown; confirm?: unknown }
      this.bodies.push(body)
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!email.includes('@') || (what === 'delete' && body.confirm !== true)) return json({ error: 'invalid', errors: [] }, 400)
      if (this.ambiguous.has(email)) return json({ error: 'ambiguous' }, 409)
      const account = this.accounts.get(email)
      if (what === 'lookup') return json(account ? { found: true, ...account } : { found: false })
      return json({ deleted: this.accounts.delete(email) })
    }
    if (method !== 'GET' || url.pathname !== '/v1/admin/feedback' || authorization !== `Bearer ${this.token}`) return json({ error: 'not_found' }, 404)
    const limit = Number(url.searchParams.get('limit') ?? '50')
    const before = url.searchParams.get('before')
    const kind = url.searchParams.get('kind')
    const since = url.searchParams.get('since')
    const asked = this.knowsIds ? url.searchParams.get('ids') : null
    if (asked !== null && !/^[1-9]\d{0,14}(,[1-9]\d{0,14}){0,99}$/.test(asked)) return json({ error: 'invalid', errors: ['ids must be 1 to 100 message ids'] }, 400)
    const ids = asked === null ? null : asked.split(',').map(Number)
    const found = this.items
      .filter((item) => (before === null || item.id < Number(before)) && (kind === null || item.kind === kind) && (since === null || item.receivedAt >= Number(since)) && (ids === null || ids.includes(item.id)))
      .sort((a, b) => b.id - a.id)
    const items = found.slice(0, limit)
    return json({ items, nextBefore: found.length > limit ? items.at(-1)!.id : null } satisfies FeedbackPage)
  }
}
