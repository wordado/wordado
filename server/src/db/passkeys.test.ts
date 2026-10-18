import { describe, expect, it } from 'vitest'
import { withScratchDatabase } from '../../test/db'
import { readMigrationFiles } from '../../scripts/migrationFiles'
import { migrate } from './migrate'

const files = readMigrationFiles()
const before = files.filter((f) => f.name < '0013_')
const through = files.filter((f) => f.name <= '0013_passkeys.sql')

const insert = `insert into passkey (id, name, "publicKey", "userId", "credentialID", counter, "deviceType", "backedUp", transports, "createdAt", aaguid)
  values ($1, 'Ana''s phone', 'pk', 'u1', $2, 0, 'multiDevice', true, 'internal', now(), 'ad3c0000-0000-0000-0000-000000000000')`

describe('migration 0013 (#287)', () => {
  it('adds the passkey table, which keeps no name and no authenticator model', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, before)
      await db.query(`insert into "user" (id, name, email, "emailVerified", "updatedAt") values ('u1', '', 'ana@example.com', true, now())`)
      expect(await migrate(db, through)).toEqual(['0013_passkeys.sql'])
      await db.query(insert, ['p1', 'cred-1'])
      expect(await db.query('select name, aaguid from passkey where id = $1', ['p1'])).toEqual([{ name: null, aaguid: null }])
      await db.query(`update passkey set name = 'Renamed', aaguid = 'ad3c' where id = 'p1'`)
      expect(await db.query('select name, aaguid from passkey where id = $1', ['p1'])).toEqual([{ name: null, aaguid: null }])
    })
  })

  it('refuses a second row for one credential, and goes with the user', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, before)
      await db.query(`insert into "user" (id, name, email, "emailVerified", "updatedAt") values ('u1', '', 'ana@example.com', true, now())`)
      await migrate(db, through)
      await db.query(insert, ['p1', 'cred-1'])
      await expect(db.query(insert, ['p2', 'cred-1'])).rejects.toThrow()
      await db.query(`delete from "user" where id = 'u1'`)
      expect(await db.query('select id from passkey')).toEqual([])
    })
  })
})
