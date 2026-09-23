import type { Db } from './db/db'

/** `fetch` as the server calls it; injectable so tests need no network. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>

export interface VapidKeys {
  /** The uncompressed P-256 public key, base64url (65 bytes). */
  readonly publicKey: string
  /** The private scalar d, base64url (32 bytes). */
  readonly privateKey: string
  /** A mailto: or https: contact the push services may use. */
  readonly subject: string
}

export interface ServerConfig {
  /** Where the app is served from: Better Auth's baseURL. */
  readonly baseUrl: string
  /** Other origins allowed to call with the session cookie (the Vite dev server, in development). */
  readonly trustedOrigins: readonly string[]
  readonly authSecret: string
  /** Pushes and pulls below this protocol version get `upgrade_required` (spec §4.3). */
  readonly minProtocolVersion: number
  readonly google: { readonly clientId: string; readonly clientSecret: string } | null
  /** Null disables reminders. */
  readonly vapid: VapidKeys | null
}

export interface Mailer {
  sendSignInCode(email: string, code: string): Promise<void>
}

/** A queue message (spec §4.4): one learner's work, small and safe to retry. */
export type Job = { readonly kind: 'rederive'; readonly userId: string }

export interface JobQueue {
  send(job: Job): Promise<void>
  sendBatch(jobs: readonly Job[]): Promise<void>
}

export interface PushSender {
  /** Wakes one subscription. `gone` when the push service no longer knows it; throws on any other failure. */
  send(endpoint: string): Promise<'sent' | 'gone'>
}

/** Everything outside the app. The Worker builds these from bindings (Task 11); tests from fakes. */
export interface ServerDeps {
  readonly db: Db
  readonly config: ServerConfig
  /** The server's clock in epoch milliseconds. Stamping reads only this. */
  now(): number
  readonly mailer: Mailer
  readonly jobs: JobQueue
  readonly push: PushSender
  /** Work that may finish after the response: `ctx.waitUntil` in the Worker. */
  background(promise: Promise<unknown>): void
}
