import { describe, expect, it } from 'vitest'
import { withScratchDatabase } from '../../test/db'
import type { Db } from './db'
import { emptyPreview } from './emptyPreview'
import { migrate } from './migrate'
import { readMigrationFiles } from '../../scripts/migrationFiles'

const first = { name: '0001_first.sql', sql: 'create table a (n int);' }
const second = { name: '0002_second.sql', sql: 'create table "b b" (n int primary key); create table c (n int references "b b");' }

async function mark(db: Db, name: string): Promise<void> {
  await db.query('create schema wordado_env; create table wordado_env.environment (name text not null)')
  await db.query('insert into wordado_env.environment (name) values ($1)', [name])
}

async function publicTables(db: Db): Promise<string[]> {
  const rows = await db.query<{ name: string }>(`select tablename as name from pg_tables where schemaname = 'public' order by 1`)
  return rows.map((r) => r.name)
}

describe('emptyPreview', () => {
  it('refuses a database without the preview marker, and drops nothing', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, [first])
      await expect(emptyPreview(db)).rejects.toThrow('not marked as the preview')
      expect(await publicTables(db)).toEqual(['a', 'schema_migration'])
    })
  })

  it('refuses a database marked as another environment', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, [first])
      await mark(db, 'production')
      await expect(emptyPreview(db)).rejects.toThrow('not marked as the preview')
      expect(await publicTables(db)).toEqual(['a', 'schema_migration'])
    })
  })

  it('drops every table in public, the migration record too, and keeps the marker', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, [first, second])
      await mark(db, 'preview')
      expect(await emptyPreview(db)).toEqual(['a', 'b b', 'c', 'schema_migration'])
      expect(await publicTables(db)).toEqual([])
      expect(await db.query('select name from wordado_env.environment')).toEqual([{ name: 'preview' }])
    })
  })

  it('lets a branch without another branch’s migration deploy after it (#205)', async () => {
    await withScratchDatabase(async (db) => {
      await mark(db, 'preview')
      await migrate(db, [first, second])
      await emptyPreview(db)
      expect(await migrate(db, [first])).toEqual(['0001_first.sql'])
      expect(await publicTables(db)).toEqual(['a', 'schema_migration'])
    })
  })

  it('lets a migration edited during review deploy again', async () => {
    await withScratchDatabase(async (db) => {
      await mark(db, 'preview')
      await migrate(db, [first])
      await emptyPreview(db)
      expect(await migrate(db, [{ ...first, sql: 'create table a (n bigint);' }])).toEqual(['0001_first.sql'])
    })
  })

  it('leaves nothing behind that stops the real migrations running again', async () => {
    await withScratchDatabase(async (db) => {
      await mark(db, 'preview')
      const files = readMigrationFiles()
      await migrate(db, files)
      await emptyPreview(db)
      expect(await migrate(db, files)).toEqual(files.map((f) => f.name))
    })
  })

  it('is a no-op on an empty marked database', async () => {
    await withScratchDatabase(async (db) => {
      await mark(db, 'preview')
      expect(await emptyPreview(db)).toEqual([])
    })
  })
})
