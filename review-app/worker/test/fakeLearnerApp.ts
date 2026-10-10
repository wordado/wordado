import type { FeedbackItem, FeedbackPage } from '@wordado/core'

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

/** The learner app server's `GET /v1/admin/feedback`, in memory (spec §13): the token, the pages and the kind filter as the real route has them. */
export class FakeLearnerApp {
  /** Every request made, as `METHOD path?query`. */
  readonly requests: string[] = []
  /** Set, every request gets this instead: a status with a body, or an error thrown as when the server is not reached. */
  failure: { status: number; body: string } | Error | null = null
  constructor(readonly token: string, public items: FeedbackItem[] = []) {}

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input)
    const method = init.method ?? 'GET'
    this.requests.push(`${method} ${url.pathname}${url.search}`)
    if (this.failure instanceof Error) throw this.failure
    if (this.failure) return new Response(this.failure.body, { status: this.failure.status })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    const authorization = new Headers(init.headers).get('authorization')
    if (method !== 'GET' || url.pathname !== '/v1/admin/feedback' || authorization !== `Bearer ${this.token}`) return json({ error: 'not_found' }, 404)
    const limit = Number(url.searchParams.get('limit') ?? '50')
    const before = url.searchParams.get('before')
    const kind = url.searchParams.get('kind')
    const found = this.items
      .filter((item) => (before === null || item.id < Number(before)) && (kind === null || item.kind === kind))
      .sort((a, b) => b.id - a.id)
    const items = found.slice(0, limit)
    return json({ items, nextBefore: found.length > limit ? items.at(-1)!.id : null } satisfies FeedbackPage)
  }
}
