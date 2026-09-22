export type SqlValue = string | number | null | Uint8Array
export type SqlRow = Record<string, SqlValue>

/**
 * The one thing web and mobile implement differently (spec §4.1): one SQLite
 * connection, statements run in call order, parameters positional.
 */
export interface SqlDriver {
  /** One or more statements with no result: DDL, PRAGMA, BEGIN/COMMIT. */
  exec(sql: string): Promise<void>
  run(sql: string, params?: readonly SqlValue[]): Promise<void>
  all<T extends object = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T[]>
  close(): Promise<void>
}
