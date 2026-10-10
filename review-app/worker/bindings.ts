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
}
