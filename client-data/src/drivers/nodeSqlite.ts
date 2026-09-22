import { DatabaseSync } from 'node:sqlite'
import type { SqlDriver, SqlValue } from '../driver'

/**
 * The in-process driver the suites run against (spec §4.1, §13). Node only:
 * the web driver (wa-sqlite over OPFS) is plan 6's, and nothing under `src/`
 * outside `drivers/` and `testing/` may import this.
 */
export function nodeSqliteDriver(path = ':memory:'): SqlDriver {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  return {
    exec: async (sql) => {
      db.exec(sql)
    },
    run: async (sql, params: readonly SqlValue[] = []) => {
      db.prepare(sql).run(...params)
    },
    all: async <T extends object>(sql: string, params: readonly SqlValue[] = []) =>
      db.prepare(sql).all(...params) as unknown as T[],
    close: async () => {
      db.close()
    },
  }
}
