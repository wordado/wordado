import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { nodeSqliteDriver } from './drivers/nodeSqlite'

function open(): Database {
  return new Database(nodeSqliteDriver())
}

describe('Database', () => {
  it('runs statements and reads rows back', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, blob BLOB)')
    await db.run('INSERT INTO t (name, blob) VALUES (?, ?)', ['a', new Uint8Array([1, 2, 3])])
    const rows = await db.all<{ id: number; name: string; blob: Uint8Array }>('SELECT * FROM t')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('a')
    expect([...rows[0]!.blob]).toEqual([1, 2, 3])
    await db.close()
  })

  it('commits a transaction and returns its result', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (n INTEGER)')
    const result = await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t VALUES (1)')
      await tx.run('INSERT INTO t VALUES (2)')
      return 'done'
    })
    expect(result).toBe('done')
    expect(await db.all('SELECT count(*) AS c FROM t')).toEqual([{ c: 2 }])
  })

  it('rolls back when the function throws, and rethrows', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (n INTEGER)')
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t VALUES (1)')
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await db.all('SELECT count(*) AS c FROM t')).toEqual([{ c: 0 }])
    // The database is usable afterwards.
    await db.transaction((tx) => tx.run('INSERT INTO t VALUES (2)'))
    expect(await db.all('SELECT n FROM t')).toEqual([{ n: 2 }])
  })

  it('serialises transactions in call order', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (n INTEGER)')
    const order: number[] = []
    const first = db.transaction(async (tx) => {
      await new Promise((r) => setTimeout(r, 20))
      await tx.run('INSERT INTO t VALUES (1)')
      order.push(1)
    })
    const second = db.transaction(async (tx) => {
      await tx.run('INSERT INTO t VALUES (2)')
      order.push(2)
    })
    await Promise.all([first, second])
    expect(order).toEqual([1, 2])
    expect(await db.all('SELECT n FROM t ORDER BY rowid')).toEqual([{ n: 1 }, { n: 2 }])
  })
})
