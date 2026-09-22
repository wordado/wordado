import type { SqlDriver, SqlRow, SqlValue } from './driver'

/** A driver plus serialised write transactions. Everything in `client-data` goes through one of these. */
export class Database {
  private chain: Promise<unknown> = Promise.resolve()

  constructor(readonly driver: SqlDriver) {}

  exec(sql: string): Promise<void> {
    return this.driver.exec(sql)
  }

  run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    return this.driver.run(sql, params)
  }

  all<T extends object = SqlRow>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.driver.all<T>(sql, params)
  }

  /**
   * Runs `fn` inside BEGIN IMMEDIATE … COMMIT, rolled back if it throws.
   * Transactions run one at a time in call order. Do not nest: a transaction
   * started inside another would wait for it forever.
   */
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      await this.driver.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn(this.driver)
        await this.driver.exec('COMMIT')
        return result
      } catch (err) {
        await this.driver.exec('ROLLBACK')
        throw err
      }
    }
    const next = this.chain.then(run, run)
    this.chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  close(): Promise<void> {
    return this.driver.close()
  }
}
