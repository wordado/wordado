import pg from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { withScratchDatabase } from '../../test/db'

type Ending = { connection: { end: () => void } }
const realEnd = pg.Client.prototype.end

afterEach(() => {
  pg.Client.prototype.end = realEnd
})

describe('withScratchDatabase', () => {
  it('drops the database only once its connections are closed, even when closing is slow (CI run 36121995527)', async () => {
    // A loaded CI runner: each client's goodbye reaches Postgres 100 ms late. `pool.end()` does not
    // wait for it, so a drop … with (force) straight after terminated the still-open backends and
    // their FATAL 57P01 surfaced as an unhandled pool 'error'.
    pg.Client.prototype.end = function (this: pg.Client & Ending, ...args: unknown[]) {
      const goodbye = this.connection.end.bind(this.connection)
      this.connection.end = () => void setTimeout(goodbye, 100)
      return (realEnd as (...a: unknown[]) => Promise<void>).apply(this, args)
    } as typeof realEnd
    const errors: unknown[] = []

    await withScratchDatabase(async (db) => {
      db.pool.on('error', (error) => errors.push(error))
      await Promise.all([db.query('select 1'), db.query('select 2')])
    })

    expect(errors).toEqual([])
  })
})
