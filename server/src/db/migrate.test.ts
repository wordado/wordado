import { describe, expect, it } from 'vitest'
import { withScratchDatabase } from '../../test/db'
import { readMigrationFiles } from '../../scripts/migrationFiles'
import { migrate } from './migrate'

const first = { name: '0001_first.sql', sql: 'create table a (n int);' }
const second = { name: '0002_second.sql', sql: 'create table b (n int); insert into b values (1);' }

describe('migrate', () => {
  it('applies files in name order, once', async () => {
    await withScratchDatabase(async (db) => {
      expect(await migrate(db, [second, first])).toEqual(['0001_first.sql', '0002_second.sql'])
      expect(await migrate(db, [first, second])).toEqual([])
      expect(await db.query('select n from b')).toEqual([{ n: 1 }])
    })
  })

  it('refuses a migration edited after it was applied', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, [first])
      await expect(migrate(db, [{ ...first, sql: 'create table a (n bigint);' }])).rejects.toThrow('edited after it was applied')
    })
  })

  it('refuses when an applied migration has no file', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, [first, second])
      await expect(migrate(db, [first])).rejects.toThrow('0002_second.sql was applied but its file is missing')
    })
  })

  it('applies nothing when one migration fails', async () => {
    await withScratchDatabase(async (db) => {
      await expect(migrate(db, [first, { name: '0002_broken.sql', sql: 'create tabel b (n int);' }])).rejects.toThrow()
      const tables = await db.query(`select tablename from pg_tables where schemaname = 'public'`)
      expect(tables).toEqual([])
    })
  })

  it('refuses a file whose name is not NNNN_name.sql', async () => {
    await withScratchDatabase(async (db) => {
      await expect(migrate(db, [{ name: 'first.sql', sql: '' }])).rejects.toThrow('Bad migration name')
    })
  })

  it('builds the whole schema from the repository migrations', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, readMigrationFiles())
      const rows = await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' order by tablename`)
      expect(rows.map((r) => r.tablename)).toEqual([
        'account',
        'content_report',
        'day_complete',
        'device',
        'document',
        'learner',
        'push_subscription',
        'push_window',
        'rateLimit',
        'review_event',
        'review_state',
        'schema_migration',
        'session',
        'sign_in_code_send',
        'user',
        'verification',
      ])
    })
  })
})
