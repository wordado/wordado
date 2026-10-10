import { b64url } from '../b64'
import { testAppKey } from './fakeGitHub'

/** What a request to the model holds, as the Worker's client sends it. */
interface ModelBody { model: string; messages: { role: string; content: string }[]; response_format: { json_schema?: { name?: string } }; provider?: unknown }

/** A plain reading of each message of an input: the learner's kind as the category, no translation, a summary that names the id. */
export function plainAnswer(_name: string, input: unknown): unknown {
  const messages = (input as { messages?: { id: number; kind: string }[] }).messages ?? []
  return {
    results: messages.map((m) => ({ id: m.id, language: 'en', translation: '', category: m.kind === 'other' ? 'praise' : m.kind, severity: m.kind === 'bug' ? 'annoys' : null, summary: `Message ${m.id} in short.` })),
  }
}

/** A way a request fails: a status (with this body, or with the request's own sent back), an error thrown as when the service is not reached, or 'late'. */
type Failure = { status: number; body?: string } | Error | 'late' | null

/** A service account as Google's key file holds it, made for one test run: the file's content, and the public half its tokens' signatures are checked with. */
export interface TestServiceAccount { readonly email: string; readonly keyFile: string; readonly publicKey: CryptoKey; readonly privateKeyPem: string }

/** A throwaway service account: a new RSA key each time, written nowhere. `over` changes or adds fields of the key file (undefined removes one). */
export async function testServiceAccount(over: Readonly<Record<string, unknown>> = {}): Promise<TestServiceAccount> {
  const { pem, publicKey } = await testAppKey()
  const email = 'feedback-ai@a-project.iam.gserviceaccount.com'
  const file = { type: 'service_account', project_id: 'a-project', private_key_id: 'a-key-id', private_key: pem, client_email: email, token_uri: 'https://oauth2.googleapis.com/token', ...over }
  return { email, keyFile: JSON.stringify(file), publicKey, privateKeyPem: pem }
}

/** What the token endpoint was sent: the form, and the JWT in it taken apart. */
export interface TokenRequest {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly form: Record<string, string>
  readonly header: unknown
  readonly claims: Record<string, unknown>
  /** Whether the JWT's signature is the service account's. */
  readonly signed: boolean
}

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
const GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer'

/**
 * The service the model is reached through, in memory: the key, one answer for each request, and the ways it fails.
 * With a `serviceAccount` it is Google's: any address whose path is `/token` is the token endpoint, which checks the
 * signed JWT as Google does and gives a token for an hour, and the model takes the newest token and nothing else.
 * It never asks a model, and never Google.
 */
export class FakeModel {
  /** Every request: its address, its headers and its parsed body. */
  readonly requests: { readonly url: string; readonly headers: Record<string, string>; readonly body: ModelBody }[] = []
  /** What the model says to an input; a test sets it. The default reads each message plainly. */
  answer: (name: string, input: unknown) => unknown = plainAnswer
  /** Set, every request to the model gets this instead: a status (with this body, or with the request's own sent back, as an error
   * of the service may hold it), an error thrown as when the service is not reached, or 'late'. */
  failure: Failure = null
  /** Set, the service signs in by token: this is the account whose JWTs the token endpoint takes. */
  serviceAccount: Pick<TestServiceAccount, 'email' | 'publicKey'> | null = null
  /** Every request to the token endpoint. */
  readonly tokenRequests: TokenRequest[] = []
  /** Every token given, the newest last. */
  readonly tokens: string[] = []
  /** Set, every request to the token endpoint gets this instead, as `failure` does for the model. */
  tokenFailure: Failure = null
  /** The seconds a token is said to live. */
  expiresIn = 3600
  constructor(readonly key: string) {}

  /** The token endpoint: the form is read, the JWT checked as Google checks it, and a new token given. */
  private async token(input: string, init: RequestInit): Promise<Response> {
    const sent = typeof init.body === 'string' ? init.body : ''
    const form = Object.fromEntries(new URLSearchParams(sent).entries())
    const [head = '', body = '', sig = ''] = (form['assertion'] ?? '').split('.')
    const parsed = (part: string): unknown => {
      try {
        return JSON.parse(b64url.decodeText(part)) as unknown
      } catch {
        return null
      }
    }
    const header = parsed(head) as { alg?: unknown; typ?: unknown } | null
    const claims = (parsed(body) ?? {}) as Record<string, unknown>
    let signed = false
    try {
      signed = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', this.serviceAccount!.publicKey, b64url.decode(sig) as Uint8Array<ArrayBuffer>, new TextEncoder().encode(`${head}.${body}`))
    } catch {
      signed = false
    }
    const method = init.method ?? 'GET'
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    this.tokenRequests.push({ url: input, method, headers, form, header, claims, signed })
    if (this.tokenFailure === 'late') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    if (this.tokenFailure instanceof Error) throw this.tokenFailure
    if (this.tokenFailure) return new Response([204, 301, 302, 304].includes(this.tokenFailure.status) ? null : (this.tokenFailure.body ?? sent), { status: this.tokenFailure.status })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    const { iat, exp } = claims
    const fits =
      method === 'POST' && headers['content-type'] === 'application/x-www-form-urlencoded' && form['grant_type'] === GRANT && signed &&
      header?.alg === 'RS256' && header.typ === 'JWT' && claims['iss'] === this.serviceAccount!.email && claims['scope'] === SCOPE && claims['aud'] === input &&
      typeof iat === 'number' && typeof exp === 'number' && exp > iat && exp - iat <= 3600
    if (!fits) return json({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, 400)
    const token = `ya29.fake-${this.tokens.length + 1}`
    this.tokens.push(token)
    return json({ access_token: token, expires_in: this.expiresIn, token_type: 'Bearer' })
  }

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    if (this.serviceAccount && new URL(input).pathname === '/token') return this.token(input, init)
    const sent = typeof init.body === 'string' ? init.body : ''
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    const body = JSON.parse(sent) as ModelBody
    this.requests.push({ url: input, headers, body })
    if (this.failure === 'late') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    if (this.failure instanceof Error) throw this.failure
    // A status that carries no body (204, a redirect) is answered without one.
    if (this.failure) return new Response([204, 301, 302, 304].includes(this.failure.status) ? null : (this.failure.body ?? sent), { status: this.failure.status })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    // By key, the key; by service account, the newest token and no earlier one.
    const accepted = this.serviceAccount ? this.tokens.at(-1) : this.key
    if ((init.method ?? 'GET') !== 'POST' || accepted === undefined || headers['authorization'] !== `Bearer ${accepted}`) return json({ error: { message: 'No auth credentials found', code: 401 } }, 401)
    const value = this.answer(body.response_format.json_schema?.name ?? '', this.inputOf(this.requests.length - 1))
    return json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(value) } }] })
  }

  /** The parsed `input` of request n: what the model was given. */
  inputOf(n: number): unknown {
    const user = this.requests[n]?.body.messages.find((m) => m.role === 'user')
    return JSON.parse(user?.content ?? 'null') as unknown
  }
}
