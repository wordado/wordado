import type { D1Database, D1PreparedStatement } from './bindings'

/** A budget of statements was spent: the statement that would have gone over it was not run. `message` holds numbers only. */
export class D1BudgetSpent extends Error {
  override readonly name = 'D1BudgetSpent'
}

/** A database that counts what is asked of it, and how many statements it has run so far. */
export interface CountedDb {
  readonly db: D1Database
  readonly statements: () => number
}

/**
 * `db`, counting every statement that is run: one for a `first`, an `all` or a `run`, and one for each member of a
 * `batch`, which is how the Free plan's limit of queries for one invocation of a Worker is taken to count (the
 * documentation does not say that a batch is one, so each of its statements is counted). With a `limit`, the
 * statement that would go over it is not run: D1BudgetSpent is thrown instead, so that what runs under the budget
 * cannot use up what the rest of the invocation needs.
 */
export function countedDb(db: D1Database, limit = Infinity): CountedDb {
  let run = 0
  const spend = (n: number) => {
    if (run + n > limit) throw new D1BudgetSpent(`${run + n} statements asked for, ${limit} allowed`)
    run += n
  }
  const inner = new WeakMap<D1PreparedStatement, D1PreparedStatement>()
  const wrap = (real: D1PreparedStatement): D1PreparedStatement => {
    const counted: D1PreparedStatement = {
      bind: (...values) => wrap(real.bind(...values)),
      first: async <T,>() => (spend(1), real.first<T>()),
      all: async <T,>() => (spend(1), real.all<T>()),
      run: async () => (spend(1), real.run()),
    }
    inner.set(counted, real)
    return counted
  }
  return {
    db: {
      prepare: (sql) => wrap(db.prepare(sql)),
      batch: async (statements) => (spend(statements.length), db.batch(statements.map((s) => inner.get(s) ?? s))),
    },
    statements: () => run,
  }
}
