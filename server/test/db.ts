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

/**
 * Tracks the pool's connections, for `closeAll`: ends the pool and waits until the server has
 * closed every socket. `pool.end()` alone resolves once each idle client has only been *asked* to
 * end, its socket still open; a `drop database … with (force)` in that window terminates the
 * backend, and its FATAL 57P01 reaches a client nobody listens to any more: an unhandled pool
 * 'error'. pg-pool emits 'remove' from `client.end`'s callback, after the socket has closed.
 */
function trackConnections(db: Db): { closeAll: () => Promise<void> } {
  let open = 0
  let allClosed: (() => void) | null = null
  db.pool.on('connect', () => {
    open += 1
  })
  db.pool.on('remove', () => {
    open -= 1
    if (open === 0) allClosed?.()
  })
  return {
    async closeAll() {
      const closed = open === 0 ? Promise.resolve() : new Promise<void>((resolve) => (allClosed = resolve))
      await db.end()
      await closed
    },
  }
}

/** A fresh, empty database for the length of `fn`. */
export async function withScratchDatabase(fn: (db: Db) => Promise<void>): Promise<void> {
  const name = `wordado_scratch_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`
  const admin = pgDb(createPool(adminUrl(), 1))
  await admin.query(`create database ${name}`)
  const url = new URL(TEST_DATABASE_URL)
  url.pathname = `/${name}`
  const db = pgDb(createPool(url.toString(), 2))
  const connections = trackConnections(db)
  try {
    await fn(db)
  } finally {
    await connections.closeAll()
    await admin.query(`drop database ${name} with (force)`)
    await admin.end()
  }
}

let users = 0

/** A user row as Better Auth would write it, without signing in: for tests below the HTTP layer. */
export async function createTestUser(db: Db = testDb(), createdAt = Date.now()): Promise<string> {
  users += 1
  const id = `user-${users}-${Math.random().toString(36).slice(2, 10)}`
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, '', $2, true, $3, $3)`,
    [id, `${id}@example.com`, new Date(createdAt)],
  )
  return id
}
