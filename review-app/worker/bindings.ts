export interface D1Meta { readonly last_row_id: number; readonly changes: number }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: D1Meta }>
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>
}
export interface R2ObjectBody { text(): Promise<string> }
export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
  put(key: string, value: string): Promise<unknown>
}
/** What the runtime hands a timed job: the cron line that fired, as the config writes it, and when. */
export interface ScheduledController { readonly cron: string; readonly scheduledTime: number }

export interface Env {
  readonly DB: D1Database
  readonly SNAPSHOTS: R2Bucket
  readonly APP_ORIGIN: string
  readonly ACCESS_TEAM_DOMAIN: string
  readonly ACCESS_AUD: string
  /** Tests and the hosted e2e only: a JWKS JSON used instead of the team's keys. Honoured only on a local or test APP_ORIGIN (access.ts); check-config refuses it in production. */
  readonly ACCESS_JWKS?: string
  /** A secret; when unset no first admin is created (the Worker logs a warning). */
  readonly ADMIN_EMAIL?: string
  readonly CONTENT_REPO: string
  readonly GITHUB_APP_ID: string
  readonly GITHUB_INSTALLATION_ID: string
  /** Tests and e2e only: a fake GitHub API's base URL. */
  readonly GITHUB_API_URL?: string
  readonly GITHUB_APP_PRIVATE_KEY?: string
  readonly GITHUB_WEBHOOK_SECRET?: string
  readonly RESEND_API_KEY?: string
  readonly MAIL_FROM: string
  /** The learner app's server, whose feedback the Feedback tab reads (spec §16); empty or unset leaves the tab unconnected. */
  readonly LEARNER_APP_URL?: string
  /** A secret, the same value as that server's: what it answers to. Unset leaves the tab unconnected. */
  readonly FEEDBACK_READ_TOKEN?: string
  /** A secret: the key the AI help on feedback reaches its model with (spec 2026-10-10 §4). Unset, there is no AI help and the tab says so. */
  readonly FEEDBACK_AI_KEY?: string
  /** The model, as the service names it; unset is the default of feedbackAiConfig.ts. */
  readonly FEEDBACK_AI_MODEL?: string
  /** How many calls to the model a UTC day may have: a whole number from 0 up; unset is 200. */
  readonly FEEDBACK_AI_DAILY_CALLS?: string
  /** The languages the coordinator reads, which need no translation: two-letter codes with commas; unset is `en,bg`. */
  readonly FEEDBACK_READS?: string
  /** Tests and the hosted e2e only: a stand-in model's address. Honoured only on a local or test APP_ORIGIN (feedbackAiConfig.ts); check-config refuses it in production. */
  readonly FEEDBACK_AI_URL?: string
}
