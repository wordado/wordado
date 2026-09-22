import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import { ensureDevice, getMeta, getUserId, nextDeviceSeq, setMeta, setUserId } from './meta'
import { MIGRATIONS, migrate, SCHEMA_VERSION, SHIPPED_SCHEMAS, tableNames } from './schema'
import { testEnv } from './testing/testEnv'

const EXPECTED_TABLES = ['day_complete', 'day_summary', 'device_mark', 'document', 'meta', 'pack', 'review_event', 'review_state']

describe('migrate', () => {
  it('brings a fresh database to the current schema', async () => {
    const db = new Database(nodeSqliteDriver())
    expect(await migrate(db)).toEqual({ from: 0, to: SCHEMA_VERSION })
    expect(await tableNames(db)).toEqual(EXPECTED_TABLES)
    expect(await getMeta(db.driver, 'schema_version')).toBe(String(SCHEMA_VERSION))
  })

  it('is a no-op the second time', async () => {
    const db = new Database(nodeSqliteDriver())
    await migrate(db)
    expect(await migrate(db)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION })
  })

  it('refuses a database newer than this build', async () => {
    const db = new Database(nodeSqliteDriver())
    await migrate(db)
    await setMeta(db.driver, 'schema_version', String(SCHEMA_VERSION + 1))
    await expect(migrate(db)).rejects.toThrow(/newer/)
  })

  it('migrates from every shipped schema to the current one (spec §13)', async () => {
    for (const [version, ddl] of Object.entries(SHIPPED_SCHEMAS)) {
      const db = new Database(nodeSqliteDriver())
      await db.exec(ddl)
      await setMeta(db.driver, 'schema_version', version)
      expect(await migrate(db)).toEqual({ from: Number(version), to: SCHEMA_VERSION })
      expect(await tableNames(db)).toEqual(EXPECTED_TABLES)
    }
    expect(MIGRATIONS.map((m) => m.version)).toEqual(Object.keys(SHIPPED_SCHEMAS).map(Number))
  })
})

describe('meta', () => {
  it('mints one device id and keeps it', async () => {
    const db = new Database(nodeSqliteDriver())
    await migrate(db)
    const env = testEnv()
    const id = await ensureDevice(db, env)
    expect(id).toBe('00000000-0000-4000-8000-000000000001')
    expect(await ensureDevice(db, env)).toBe(id)
  })

  it('hands out device sequence numbers from 1, persisted', async () => {
    const db = new Database(nodeSqliteDriver())
    await migrate(db)
    const a = await db.transaction((tx) => nextDeviceSeq(tx))
    const b = await db.transaction((tx) => nextDeviceSeq(tx))
    expect([a, b]).toEqual([1, 2])
    expect(await getMeta(db.driver, 'next_device_seq')).toBe('3')
  })

  it('stores the user once attached', async () => {
    const db = new Database(nodeSqliteDriver())
    await migrate(db)
    expect(await getUserId(db)).toBeNull()
    await db.transaction((tx) => setUserId(tx, 'user-1'))
    expect(await getUserId(db)).toBe('user-1')
  })
})
