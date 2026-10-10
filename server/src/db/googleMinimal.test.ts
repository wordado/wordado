import { describe, expect, it } from 'vitest'
import { withScratchDatabase } from '../../test/db'
import { readMigrationFiles } from '../../scripts/migrationFiles'
import { migrate } from './migrate'

const files = readMigrationFiles()
const before = files.filter((f) => f.name < '0007_')
const through = files.filter((f) => f.name <= '0007_google_minimal.sql')

describe('migration 0007 (#163)', () => {
  it('blanks the Google profile and tokens that earlier sign-ins stored, and leaves the rest', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, before)
      await db.query(
        `insert into "user" (id, name, email, "emailVerified", image, "updatedAt", country) values
           ('u1', 'Ana', 'ana@example.com', true, 'https://example.com/ana.png', now(), 'BG'),
           ('u2', '', 'ben@example.com', true, null, now(), null)`,
      )
      await db.query(
        `insert into account (id, "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", scope, "updatedAt") values
           ('a1', 'google-sub', 'google', 'u1', 'ya29', '1//r', 'eyJ', now(), 'openid email', now()),
           ('a2', 'u2', 'credential', 'u2', null, null, null, null, null, now())`,
      )
      expect(await migrate(db, through)).toEqual(['0007_google_minimal.sql'])
      expect(await db.query('select id, name, image, email, country from "user" order by id')).toEqual([
        { id: 'u1', name: '', image: null, email: 'ana@example.com', country: 'BG' },
        { id: 'u2', name: '', image: null, email: 'ben@example.com', country: null },
      ])
      expect(await db.query('select id, "accountId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", scope from account order by id')).toEqual([
        { id: 'a1', accountId: 'google-sub', accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, scope: null },
        { id: 'a2', accountId: 'u2', accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, scope: null },
      ])
    })
  })
})
