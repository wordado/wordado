import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MigrationFile } from '../src/db/migrate'

/** server/migrations/*.sql, in name order. */
export function readMigrationFiles(dir = join(import.meta.dirname, '..', 'migrations')): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
}
