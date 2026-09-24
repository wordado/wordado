import { createApp } from '../src/app'
import type { Job, ServerConfig, ServerDeps } from '../src/deps'
import { testDb } from './db'

export const BASE_URL = 'http://localhost:8787'

export interface Reply {
  readonly status: number
  /** Parsed JSON, or the text when it is not JSON. Tests read bodies loosely. */
  readonly body: any
  readonly headers: Headers
}

export interface Session {
  readonly userId: string
  readonly email: string
  readonly cookie: string
  get(path: string, headers?: Record<string, string>): Promise<Reply>
  post(path: string, body: unknown, headers?: Record<string, string>): Promise<Reply>
  put(path: string, body: unknown, headers?: Record<string, string>): Promise<Reply>
  del(path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply>
}

export interface TestClock {
  now: number
  advance(ms: number): void
}

export interface Harness {
  readonly app: ReturnType<typeof createApp>
  readonly deps: ServerDeps
  readonly clock: TestClock
  /** Every sign-in code the mailer was given. */
  readonly codes: { readonly email: string; readonly code: string }[]
  readonly jobs: Job[]
  /** Every endpoint the push sender was asked to wake. */
  readonly pushed: string[]
  /** What the next push sends answer. */
  pushResult: 'sent' | 'gone' | Error
  request(path: string, init?: RequestInit): Promise<Reply>
  signIn(email?: string): Promise<Session>
  /** Waits for the work handed to `deps.background`. */
  settle(): Promise<void>
}

export interface HarnessOptions {
  readonly config?: Partial<ServerConfig>
  /** The server's clock; defaults to a TestClock starting at the real time. */
  readonly now?: () => number
}

async function toReply(response: Response): Promise<Reply> {
  const text = await response.text()
  let body: unknown = null
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body, headers: response.headers }
}

let learners = 0

/** The real app over the suite's database, with recording fakes for everything outside it. */
export function harness(options: HarnessOptions = {}): Harness {
  const clock: TestClock = {
    now: Date.now(),
    advance(ms) {
      this.now += ms
    },
  }
  const pending: Promise<unknown>[] = []
  const codes: { email: string; code: string }[] = []
  const jobs: Job[] = []
  const pushed: string[] = []
  const deps: ServerDeps = {
    db: testDb(),
    config: {
      baseUrl: BASE_URL,
      trustedOrigins: [],
      authSecret: 'b4f1c9e07a2d4e6f8a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d',
      minProtocolVersion: 1,
      google: null,
      vapid: null,
      ...options.config,
    },
    now: options.now ?? (() => clock.now),
    mailer: {
      async sendSignInCode(email, code) {
        codes.push({ email, code })
      },
    },
    jobs: {
      async send(job) {
        jobs.push(job)
      },
      async sendBatch(batch) {
        jobs.push(...batch)
      },
    },
    push: {
      async send(endpoint) {
        pushed.push(endpoint)
        if (h.pushResult instanceof Error) throw h.pushResult
        return h.pushResult
      },
    },
    background: (promise) => {
      pending.push(promise)
    },
  }
  const app = createApp(deps)
  const request = async (path: string, init: RequestInit = {}) => toReply(await app.request(path, init))

  function session(userId: string, email: string, cookie: string): Session {
    const send = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      request(path, {
        method,
        headers: { cookie, origin: BASE_URL, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    return {
      userId,
      email,
      cookie,
      get: (path, headers) => send('GET', path, undefined, headers),
      post: (path, body, headers) => send('POST', path, body, headers),
      put: (path, body, headers) => send('PUT', path, body, headers),
      del: (path, body, headers) => send('DELETE', path, body, headers),
    }
  }

  const h: Harness = {
    app,
    deps,
    clock,
    codes,
    jobs,
    pushed,
    pushResult: 'sent',
    request,
    async settle() {
      await Promise.all(pending.splice(0))
    },
    async signIn(email) {
      learners += 1
      const address = email ?? `learner-${learners}-${Math.random().toString(36).slice(2, 8)}@example.com`
      // A fresh address per call keeps each sign-in in its own rate-limit bucket.
      const headers = { 'content-type': 'application/json', origin: BASE_URL, 'cf-connecting-ip': `10.1.${learners >> 8}.${learners & 255}` }
      const sent = await app.request('/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: address, type: 'sign-in' }),
      })
      if (sent.status !== 200) throw new Error(`send code: ${sent.status} ${await sent.text()}`)
      await h.settle()
      const code = [...codes].reverse().find((c) => c.email === address)?.code
      if (!code) throw new Error(`no code was sent to ${address}`)
      const signedIn = await app.request('/api/auth/sign-in/email-otp', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: address, otp: code }),
      })
      if (signedIn.status !== 200) throw new Error(`sign in: ${signedIn.status} ${await signedIn.text()}`)
      const cookie = signedIn.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ')
      const { user } = (await signedIn.json()) as { user: { id: string } }
      return session(user.id, address, cookie)
    },
  }
  return h
}
