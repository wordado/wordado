import type { Database } from './database'
import type { SqlDriver } from './driver'
import type { ClientEnv } from './env'

export async function getMeta(driver: SqlDriver, key: string): Promise<string | null> {
  const rows = await driver.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])
  return rows[0]?.value ?? null
}

export async function setMeta(driver: SqlDriver, key: string, value: string): Promise<void> {
  await driver.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value])
}

/** The device's identity (spec §6.2). A browser whose storage was cleared becomes a new device. */
export async function ensureDevice(db: Database, env: ClientEnv): Promise<string> {
  const existing = await getMeta(db.driver, 'device_id')
  if (existing !== null) return existing
  const id = env.uuid()
  await db.transaction(async (tx) => {
    if ((await getMeta(tx, 'device_id')) === null) await setMeta(tx, 'device_id', id)
  })
  return (await getMeta(db.driver, 'device_id')) ?? id
}

/** The per-device monotonic counter (spec §6.2). Call inside the transaction that stores the event. */
export async function nextDeviceSeq(tx: SqlDriver): Promise<number> {
  const seq = Number((await getMeta(tx, 'next_device_seq')) ?? '1')
  await setMeta(tx, 'next_device_seq', String(seq + 1))
  return seq
}

export async function getUserId(db: Database): Promise<string | null> {
  return getMeta(db.driver, 'user_id')
}

export async function setUserId(tx: SqlDriver, userId: string): Promise<void> {
  await setMeta(tx, 'user_id', userId)
}
