import type { Db } from './db'

export interface MigrationFile {
  /** `NNNN_name.sql`; applied in name order. */
  readonly name: string
  readonly sql: string
}

const NAME = /^\d{4}_[a-z0-9_]+\.sql$/

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Applies the migrations not yet applied, in name order, in one transaction
 * (spec §4.4: forward-only). A migration whose text changed after it was
 * applied, or whose file is gone, is an error: the fix is a new migration,
 * never an edit. Returns the names it applied.
 */
export async function migrate(db: Db, files: readonly MigrationFile[]): Promise<string[]> {
  for (const file of files) if (!NAME.test(file.name)) throw new Error(`Bad migration name ${file.name}`)
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return db.transaction(async (tx) => {
    // One migrator at a time: a deploy and a developer, say.
    await tx.query('select pg_advisory_xact_lock(7271)')
    await tx.query(
      'create table if not exists schema_migration (name text primary key, checksum text not null, applied_at timestamptz not null default now())',
    )
    const rows = await tx.query<{ name: string; checksum: string }>('select name, checksum from schema_migration')
    const applied = new Map(rows.map((r) => [r.name, r.checksum]))
    for (const name of applied.keys()) {
      if (!sorted.some((file) => file.name === name)) throw new Error(`Migration ${name} was applied but its file is missing`)
    }
    const done: string[] = []
    for (const file of sorted) {
      const checksum = await sha256(file.sql)
      const previous = applied.get(file.name)
      if (previous !== undefined) {
        if (previous !== checksum) throw new Error(`Migration ${file.name} was edited after it was applied`)
        continue
      }
      // No parameters: the simple protocol, which runs a file of several statements.
      await tx.query(file.sql)
      await tx.query('insert into schema_migration (name, checksum) values ($1, $2)', [file.name, checksum])
      done.push(file.name)
    }
    return done
  })
}
