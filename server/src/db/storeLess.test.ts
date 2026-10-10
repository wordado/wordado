import { describe, expect, it } from 'vitest'
import { withScratchDatabase } from '../../test/db'
import { readMigrationFiles } from '../../scripts/migrationFiles'
import { migrate } from './migrate'

const files = readMigrationFiles()
const before = files.filter((f) => f.name < '0008_')
const through = files.filter((f) => f.name <= '0008_store_less.sql')

describe('migration 0008 (#166)', () => {
  it('drops the country, the session details, the plain limit keys, the linked sign-ins and the feedback link, keeping the rest', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, before)
      await db.query(
        `insert into "user" (id, name, email, "emailVerified", "updatedAt", country) values
           ('u1', '', 'ana@example.com', true, now(), 'BG'), ('u2', '', 'ben@example.com', true, now(), null)`,
      )
      await db.query(
        `insert into "session" (id, "expiresAt", token, "updatedAt", "ipAddress", "userAgent", "userId") values
           ('s1', now() + interval '1 day', 't1', now(), '203.0.113.7', 'Mozilla/5.0', 'u1')`,
      )
      await db.query(`insert into "rateLimit" (id, key, count, "lastRequest") values ('r1', '203.0.113.7|/sign-in/email-otp', 2, 1)`)
      await db.query(
        `insert into account (id, "accountId", "providerId", "userId", "updatedAt") values
           ('a1', 'google-sub', 'google', 'u1', now()), ('a2', 'u2', 'credential', 'u2', now())`,
      )
      await db.query(
        `insert into feedback (user_id, kind, message, app_version, corpus_version, user_agent, language, screen, received_at, mailed_at) values
           ('u1', 'idea', 'from a learner', 'v', 'bg 6', 'ua', 'bg', '/', 1, 2), (null, 'bug', 'from a visitor', 'v', 'bg 6', 'ua', 'bg', '/', 3, null)`,
      )
      expect(await migrate(db, through)).toEqual(['0008_store_less.sql'])
      expect(await db.query(`select column_name from information_schema.columns where table_name = 'user' and column_name = 'country'`)).toEqual([])
      expect(await db.query('select id, email from "user" order by id')).toEqual([
        { id: 'u1', email: 'ana@example.com' },
        { id: 'u2', email: 'ben@example.com' },
      ])
      expect(await db.query('select id, "ipAddress", "userAgent" from "session"')).toEqual([{ id: 's1', ipAddress: null, userAgent: null }])
      expect(await db.query('select key from "rateLimit"')).toEqual([])
      expect(await db.query('select id from account order by id')).toEqual([{ id: 'a2' }])
      expect(await db.query('select signed_in, message from feedback order by received_at')).toEqual([
        { signed_in: true, message: 'from a learner' },
        { signed_in: false, message: 'from a visitor' },
      ])
      expect(
        await db.query(`select column_name from information_schema.columns where table_name = 'feedback' and column_name in ('user_id', 'mailed_at')`),
      ).toEqual([])
      expect(await db.query(`select tablename from pg_tables where tablename = 'feedback_mail'`)).toEqual([])
    })
  })
})
