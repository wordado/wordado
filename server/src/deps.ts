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
  /** The passkeys' relying party (#287): a registrable domain of the app's origin; once passkeys exist it cannot change without losing them. */
  readonly passkeyRpId: string
  /** Pushes and pulls below this protocol version get `upgrade_required` (spec §4.3). */
  readonly minProtocolVersion: number
  /** Null disables reminders. */
  readonly vapid: VapidKeys | null
  /** What a request to `GET /v1/admin/feedback` must carry (spec §8.12). Null closes the route. */
  readonly feedbackReadToken: string | null
  /** What a request to the routes that change something for the review app must carry (`/v1/admin/accounts/*`, #187). Null closes them. */
  readonly adminWriteToken: string | null
  /** The announcement mails sent in one UTC day at most (#185): a part of the mail provider's daily allowance, the rest of which is the sign-in codes'. */
  readonly announcementMailsPerDay: number
}

/** One announcement as one account gets it (#185, src/announcements/text.ts). */
export interface AnnouncementMail {
  readonly to: string
  readonly subject: string
  /** Plain text: an announcement has no other form. */
  readonly text: string
  /** The unsubscribe pair of a news mail; none on a service notice. */
  readonly headers: Readonly<Record<string, string>>
  /** Where an answer goes: the sending address has no mailbox. */
  readonly replyTo: string
  /** Names this mail to the provider, which sends one mail for one key however often it is asked within a day. */
  readonly idempotencyKey: string
}

export interface Mailer {
  sendSignInCode(email: string, code: string): Promise<void>
  /**
   * Throws MailNotSent (src/mail.ts) when the provider answered that it did not send, with why. Anything else
   * thrown means the outcome is not known: the mail may have gone, and is asked for again only with the same key.
   */
  sendAnnouncement(mail: AnnouncementMail): Promise<void>
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
