import pg from 'pg'

/** Anything SQL runs on: the pool, or one transaction's connection. */
export interface Queryable {
  query<T extends object = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
}

export interface Db extends Queryable {
  /** The pool itself, which Better Auth takes directly. */
  readonly pool: pg.Pool
  /** Runs `fn` in one transaction on one connection, rolling back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
  end(): Promise<void>
}

const INT8_OID = 20
const builtInParser = pg.types.getTypeParser as (oid: number, format?: string) => unknown

/** `bigint` columns hold epoch milliseconds and counters, all far below 2^53: read them as numbers. */
const types = {
  getTypeParser: (oid: number, format?: string) => (oid === INT8_OID ? (value: string) => Number(value) : builtInParser(oid, format)),
} as unknown as pg.CustomTypesConfig

/** In the Worker, one pool per request over Hyperdrive (Cloudflare's guidance); in Node, one for the process's lifetime. */
export function createPool(connectionString: string, max = 5): pg.Pool {
  return new pg.Pool({ connectionString, max, types })
}

function runner(client: pg.Pool | pg.PoolClient): Queryable {
  return {
    async query<T extends object>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const result = await client.query(sql, params as unknown[])
      return result.rows as T[]
    },
  }
}

export function pgDb(pool: pg.Pool): Db {
  return {
    pool,
    ...runner(pool),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect()
      try {
        await client.query('begin')
        const result = await fn(runner(client))
        await client.query('commit')
        return result
      } catch (error) {
        await client.query('rollback').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },
    end: () => pool.end(),
  }
}
