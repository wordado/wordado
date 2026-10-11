import { describe, expect, it } from 'vitest'
import { withScratchDatabase } from '../../test/db'
import { readMigrationFiles } from '../../scripts/migrationFiles'
import { migrate } from './migrate'

const files = readMigrationFiles()
const before = files.filter((f) => f.name < '0011_')
const through = files.filter((f) => f.name <= '0011_announcements.sql')

describe('migration 0011 (#185)', () => {
  it('adds its tables beside the accounts that are there, and mails nobody by itself', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, before)
      await db.query(`insert into "user" (id, name, email, "emailVerified", "updatedAt") values ('u1', '', 'ana@example.com', true, now())`)
      expect(await migrate(db, through)).toEqual(['0011_announcements.sql'])
      for (const table of ['announcement', 'announcement_delivery', 'announcement_mail_day']) expect(await db.query(`select 1 from ${table}`)).toEqual([])
      expect(await db.query('select id from "user"')).toEqual([{ id: 'u1' }])
    })
  })

  it('lets the database itself hold the rules: one row an account, gone with the account, and no draft that has started', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, through)
      await db.query(`insert into "user" (id, name, email, "emailVerified", "updatedAt") values ('u1', '', 'ana@example.com', true, now()), ('u2', '', 'ben@example.com', true, now())`)
      const [a] = await db.query<{ id: number }>(`insert into announcement (kind, texts, created_at, updated_at) values ('service', '{"en": {"subject": "s", "body": "b"}}', 1, 1) returning id`)
      await expect(db.query(`insert into announcement (kind, texts, created_at, updated_at) values ('marketing', '{}', 1, 1)`)).rejects.toThrow()
      await expect(db.query(`update announcement set started_at = 2 where id = $1`, [a!.id])).rejects.toThrow()
      await expect(db.query(`update announcement set status = 'sending' where id = $1`, [a!.id])).rejects.toThrow()
      await db.query(`update announcement set status = 'sending', started_at = 2 where id = $1`, [a!.id])
      await db.query(`insert into announcement_delivery (announcement_id, user_id, language) values ($1, 'u1', 'en'), ($1, 'u2', 'bg')`, [a!.id])
      await expect(db.query(`insert into announcement_delivery (announcement_id, user_id, language) values ($1, 'u1', 'en')`, [a!.id])).rejects.toThrow()
      await expect(db.query(`insert into announcement_delivery (announcement_id, user_id, language) values ($1, 'nobody', 'en')`, [a!.id])).rejects.toThrow()
      const keys = await db.query<{ send_key: string }>('select send_key from announcement_delivery')
      expect(new Set(keys.map((k) => k.send_key)).size).toBe(2)
      await db.query(`delete from "user" where id = 'u1'`)
      expect(await db.query('select user_id from announcement_delivery')).toEqual([{ user_id: 'u2' }])
    })
  })
})
