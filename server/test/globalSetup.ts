import { createPool, pgDb } from '../src/db/db'
import { migrate } from '../src/db/migrate'
import { readMigrationFiles } from '../scripts/migrationFiles'
import { adminUrl, TEST_DATABASE_URL } from './db'

/** Recreates the suite's database and applies every migration, once per run. */
export default async function setup(): Promise<void> {
  const name = new URL(TEST_DATABASE_URL).pathname.slice(1)
  const admin = pgDb(createPool(adminUrl(), 1))
  try {
    await admin.query(`drop database if exists ${name} with (force)`)
    await admin.query(`create database ${name}`)
  } catch (error) {
    throw new Error(`Cannot reach Postgres at ${adminUrl()}. Start it with: pnpm --filter @wordado/server db:up`, { cause: error })
  } finally {
    await admin.end()
  }
  const db = pgDb(createPool(TEST_DATABASE_URL, 1))
  try {
    await migrate(db, readMigrationFiles())
  } finally {
    await db.end()
  }
}
