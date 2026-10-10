/** What a request to the model holds, as the Worker's client sends it. */
interface ModelBody { model: string; messages: { role: string; content: string }[]; response_format: { json_schema?: { name?: string } }; provider?: unknown }

/** A plain reading of each message of an input: the learner's kind as the category, no translation, a summary that names the id. */
export function plainAnswer(_name: string, input: unknown): unknown {
  const messages = (input as { messages?: { id: number; kind: string }[] }).messages ?? []
  return {
    results: messages.map((m) => ({ id: m.id, language: 'en', translation: '', category: m.kind === 'other' ? 'praise' : m.kind, severity: m.kind === 'bug' ? 'annoys' : null, summary: `Message ${m.id} in short.` })),
  }
}

/** The service the model is reached through, in memory: the key, one answer for each request, and the ways it fails. It never asks a model. */
export class FakeModel {
  /** Every request: its address, its headers and its parsed body. */
  readonly requests: { readonly url: string; readonly headers: Record<string, string>; readonly body: ModelBody }[] = []
  /** What the model says to an input; a test sets it. The default reads each message plainly. */
  answer: (name: string, input: unknown) => unknown = plainAnswer
  /** Set, every request gets this instead: a status (with this body, or with the request's own sent back, as an error
   * of the service may hold it), an error thrown as when the service is not reached, or 'late'. */
  failure: { status: number; body?: string } | Error | 'late' | null = null
  constructor(readonly key: string) {}

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const sent = typeof init.body === 'string' ? init.body : ''
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    const body = JSON.parse(sent) as ModelBody
    this.requests.push({ url: input, headers, body })
    if (this.failure === 'late') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    if (this.failure instanceof Error) throw this.failure
    // A status that carries no body (204, a redirect) is answered without one.
    if (this.failure) return new Response([204, 301, 302, 304].includes(this.failure.status) ? null : (this.failure.body ?? sent), { status: this.failure.status })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    if ((init.method ?? 'GET') !== 'POST' || headers['authorization'] !== `Bearer ${this.key}`) return json({ error: { message: 'No auth credentials found', code: 401 } }, 401)
    const value = this.answer(body.response_format.json_schema?.name ?? '', this.inputOf(this.requests.length - 1))
    return json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(value) } }] })
  }

  /** The parsed `input` of request n: what the model was given. */
  inputOf(n: number): unknown {
    const user = this.requests[n]?.body.messages.find((m) => m.role === 'user')
    return JSON.parse(user?.content ?? 'null') as unknown
  }
}
