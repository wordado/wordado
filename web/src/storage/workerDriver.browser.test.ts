import { Client, Database } from '@wordado/client-data'
import { describe, expect, it } from 'vitest'
import { webEnv } from '../env'
import { openWorkerDriver } from './workerDriver'

const unique = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

describe('openWorkerDriver', () => {
  for (const backend of ['opfs', 'idb', 'memory'] as const) {
    it(`round-trips every SqlValue type on ${backend}, and keeps the file when it persists`, async () => {
      const file = unique(backend)
      const first = await openWorkerDriver(file, [backend])
      expect(first.backend).toBe(backend)
      const { driver } = first
      await driver.exec('CREATE TABLE t (a INTEGER, b TEXT, c BLOB, d REAL, e TEXT)')
      await driver.run('INSERT INTO t VALUES (?, ?, ?, ?, ?)', [1_790_000_000_123, 'ябълка', new Uint8Array([1, 2, 3]), 0.5, null])
      expect(await driver.all('SELECT * FROM t')).toEqual([{ a: 1_790_000_000_123, b: 'ябълка', c: new Uint8Array([1, 2, 3]), d: 0.5, e: null }])
      await driver.close()
      if (backend === 'memory') return
      const again = await openWorkerDriver(file, [backend])
      expect(await again.driver.all('SELECT b FROM t')).toEqual([{ b: 'ябълка' }])
      await again.driver.close()
    })
  }

  it('prefers OPFS in Chromium', async () => {
    const { driver, backend, failures } = await openWorkerDriver(unique('pref'))
    expect(backend).toBe('opfs')
    expect(failures).toEqual([])
    await driver.close()
  })

  it('rejects a bad statement with SQLite’s message and keeps working', async () => {
    const { driver } = await openWorkerDriver(unique('err'), ['memory'])
    await expect(driver.exec('CREATE TABLE')).rejects.toThrow(/syntax error|incomplete input/)
    await driver.exec('CREATE TABLE t (x)')
    await driver.run('INSERT INTO t VALUES (?)', [1])
    expect(await driver.all('SELECT x FROM t')).toEqual([{ x: 1 }])
    await driver.close()
  })

  it('refuses calls after close', async () => {
    const { driver } = await openWorkerDriver(unique('closed'), ['memory'])
    await driver.close()
    await expect(driver.all('SELECT 1')).rejects.toThrow('closed')
  })

  it('carries client-data’s transactions: a throw rolls back', async () => {
    const { driver } = await openWorkerDriver(unique('tx'), ['opfs'])
    const db = new Database(driver)
    await db.exec('CREATE TABLE t (x INTEGER)')
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t VALUES (?)', [1])
        throw new Error('stop')
      }),
    ).rejects.toThrow('stop')
    await db.transaction((tx) => tx.run('INSERT INTO t VALUES (?)', [2]))
    expect(await db.all('SELECT x FROM t')).toEqual([{ x: 2 }])
    await db.close()
  })

  it('runs the Client: migrations, a settings write, and the same device after reopening', async () => {
    const file = unique('client')
    const env = webEnv()
    const first = await Client.open({ driver: (await openWorkerDriver(file, ['opfs'])).driver, env, l1: 'bg' })
    await first.updateSettings({ newWordLimit: 7 })
    const deviceId = first.snapshot.deviceId
    await first.close()
    const second = await Client.open({ driver: (await openWorkerDriver(file, ['opfs'])).driver, env, l1: 'bg' })
    expect(second.snapshot.settings.newWordLimit).toBe(7)
    expect(second.snapshot.deviceId).toBe(deviceId)
    await second.close()
  })
})
