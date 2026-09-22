import type { Rng } from '@wordado/core'

/** Everything platform-specific that `client-data` needs, passed in by the app. */
export interface ClientEnv {
  /** Epoch milliseconds. */
  now(): number
  /** Minutes to ADD to UTC for local time now (UTC+2 → 120): the negation of getTimezoneOffset(). */
  tzOffsetMin(): number
  /** A v4 UUID. */
  uuid(): string
  readonly rng: Rng
  /** Lowercase hex SHA-256, for pack verification (Web Crypto on the web). */
  sha256(bytes: Uint8Array): Promise<string>
}
