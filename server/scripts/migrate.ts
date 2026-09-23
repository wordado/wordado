import { createPool, pgDb } from '../src/db/db'
import { migrate } from '../src/db/migrate'
import { readMigrationFiles } from './migrationFiles'

/** Applies server/migrations to DATABASE_URL (server/.env locally; a deploy secret in plan 7). */
try {
  process.loadEnvFile('.env')
} catch {
  // No .env: DATABASE_URL comes from the environment, or the local default below.
}
const url = process.env['DATABASE_URL'] ?? 'postgres://wordado:wordado@localhost:54329/wordado'
const db = pgDb(createPool(url, 1))
try {
  const applied = await migrate(db, readMigrationFiles())
  console.log(applied.length === 0 ? 'Migrations: up to date' : `Migrations applied: ${applied.join(', ')}`)
} finally {
  await db.end()
}
