import { createPool, pgDb, type Db } from '../src/db/db'

/** The suite's database, on the Compose container (TEST_DATABASE_URL overrides it, as CI will). */
export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? 'postgres://wordado:wordado@localhost:54329/wordado_test'

/** The same server's `postgres` database: for creating and dropping databases. */
export function adminUrl(url = TEST_DATABASE_URL): string {
  const admin = new URL(url)
  admin.pathname = '/postgres'
  return admin.toString()
}

let shared: Db | null = null

/** One pool per test file; test/setup.ts closes it. */
export function testDb(): Db {
  shared ??= pgDb(createPool(TEST_DATABASE_URL))
  return shared
}

export async function closeTestDb(): Promise<void> {
  const db = shared
  shared = null
  await db?.end()
}

/** Empties every table except the migration record. */
export async function resetDb(db: Db = testDb()): Promise<void> {
  const tables = await db.query<{ name: string }>(
    `select tablename as name from pg_tables where schemaname = 'public' and tablename <> 'schema_migration'`,
  )
  if (tables.length > 0) await db.query(`truncate ${tables.map((t) => `"${t.name}"`).join(', ')} restart identity cascade`)
}

/** A fresh, empty database for the length of `fn`. */
export async function withScratchDatabase(fn: (db: Db) => Promise<void>): Promise<void> {
  const name = `wordado_scratch_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`
  const admin = pgDb(createPool(adminUrl(), 1))
  await admin.query(`create database ${name}`)
  const url = new URL(TEST_DATABASE_URL)
  url.pathname = `/${name}`
  const db = pgDb(createPool(url.toString(), 2))
  try {
    await fn(db)
  } finally {
    await db.end()
    await admin.query(`drop database ${name} with (force)`)
    await admin.end()
  }
}
