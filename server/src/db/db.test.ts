import { describe, expect, it } from 'vitest'
import { testDb } from '../../test/db'

describe('the database layer', () => {
  it('reads bigint columns as numbers', async () => {
    const [row] = await testDb().query<{ n: number }>('select 9007199254740991::bigint as n')
    expect(row?.n).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('round-trips a JSON number exactly', async () => {
    const value = { stability: 3.1234567890123457, difficulty: 5.000000000000001 }
    const [row] = await testDb().query<{ v: typeof value }>('select $1::jsonb as v', [JSON.stringify(value)])
    expect(row?.v).toEqual(value)
  })

  it('rolls a transaction back when its function throws', async () => {
    const db = testDb()
    await expect(
      db.transaction(async (tx) => {
        await tx.query(`insert into "user" (id, name, email, "emailVerified") values ('u0', '', 'u0@example.com', true)`)
        throw new Error('stop')
      }),
    ).rejects.toThrow('stop')
    expect(await db.query('select id from "user"')).toEqual([])
  })

  it('commits what the function wrote', async () => {
    const db = testDb()
    await db.transaction(async (tx) => {
      await tx.query(`insert into "user" (id, name, email, "emailVerified") values ('u1', '', 'u1@example.com', true)`)
    })
    expect(await db.query('select id from "user"')).toEqual([{ id: 'u1' }])
  })
})
