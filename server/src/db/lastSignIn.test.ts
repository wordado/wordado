import { describe, expect, it } from 'vitest'
import { withScratchDatabase } from '../../test/db'
import { readMigrationFiles } from '../../scripts/migrationFiles'
import { migrate } from './migrate'

const files = readMigrationFiles()
const before = files.filter((f) => f.name < '0010_')
const through = files.filter((f) => f.name <= '0010_last_sign_in.sql')

describe('migration 0010 (#187)', () => {
  it('dates every account that is already there from the day it runs, whatever is known of it', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, before)
      // One made long ago with no session left, one with a session used a while ago, one made a moment ago.
      await db.query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values
           ('u1', '', 'ana@example.com', true, now() - interval '5 years', now() - interval '5 years'),
           ('u2', '', 'ben@example.com', true, now() - interval '4 years', now() - interval '4 years'),
           ('u3', '', 'cyd@example.com', true, now(), now())`,
      )
      await db.query(
        `insert into "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId") values
           ('s1', now() + interval '20 days', 't1', now() - interval '3 years', now() - interval '40 days', 'u2')`,
      )
      expect(await migrate(db, through)).toEqual(['0010_last_sign_in.sql'])
      const rows = await db.query<{ id: string; recent: boolean }>(
        `select id, last_sign_in_at between now() - interval '1 minute' and now() as recent from "user" order by id`,
      )
      expect(rows).toEqual([
        { id: 'u1', recent: true },
        { id: 'u2', recent: true },
        { id: 'u3', recent: true },
      ])
      // An account made after it has no date until its first sign-in writes one (src/account/lastSignIn.ts).
      await db.query(`insert into "user" (id, name, email, "emailVerified", "updatedAt") values ('u4', '', 'dee@example.com', true, now())`)
      expect(await db.query(`select last_sign_in_at from "user" where id = 'u4'`)).toEqual([{ last_sign_in_at: null }])
      expect(await db.query('select utc_day, ran_at, deleted from account_sweep')).toEqual([])
    })
  })
})
