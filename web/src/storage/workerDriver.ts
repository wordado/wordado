import type { SqlDriver, SqlValue } from '@wordado/client-data'
import { BACKENDS, type Backend, type OpenResult, type WorkerCall, type WorkerResponse } from './protocol'

export interface OpenedDriver {
  readonly driver: SqlDriver
  readonly backend: Backend
  readonly failures: readonly string[]
}

export type WorkerFactory = () => Worker

const sqliteWorker: WorkerFactory = () =>
  new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module', name: 'wordado-sqlite' })

/**
 * The web SqlDriver (plan 4 contract): every call is a message to the Worker,
 * answered in order. `close` terminates the Worker, which releases the OPFS
 * file for another tab (spec §9.1).
 */
export async function openWorkerDriver(
  file: string,
  backends: readonly Backend[] = BACKENDS,
  makeWorker: WorkerFactory = sqliteWorker,
): Promise<OpenedDriver> {
  const worker = makeWorker()
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  let nextId = 1
  let broken: Error | null = null

  const failAll = (error: Error) => {
    broken = error
    for (const p of pending.values()) p.reject(error)
    pending.clear()
  }

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data
    const waiting = pending.get(response.id)
    if (!waiting) return
    pending.delete(response.id)
    if (response.ok) waiting.resolve(response.value)
    else waiting.reject(new Error(response.error))
  }
  worker.onerror = (event) => {
    event.preventDefault()
    failAll(new Error(`The database worker failed: ${event.message || 'unknown error'}`))
  }

  const call = (message: WorkerCall): Promise<unknown> => {
    if (broken) return Promise.reject(broken)
    return new Promise((resolve, reject) => {
      const id = nextId
      nextId += 1
      pending.set(id, { resolve, reject })
      worker.postMessage({ ...message, id })
    })
  }

  let opened: OpenResult
  try {
    opened = (await call({ op: 'open', file, backends })) as OpenResult
  } catch (err) {
    worker.terminate()
    throw err
  }

  const driver: SqlDriver = {
    exec: async (sql) => {
      await call({ op: 'exec', sql })
    },
    run: async (sql, params: readonly SqlValue[] = []) => {
      await call({ op: 'run', sql, params: [...params] })
    },
    all: async <T extends object>(sql: string, params: readonly SqlValue[] = []) => (await call({ op: 'all', sql, params: [...params] })) as T[],
    close: async () => {
      try {
        await call({ op: 'close' })
      } finally {
        worker.terminate()
        failAll(new Error('The database is closed'))
      }
    },
  }
  return { driver, backend: opened.backend, failures: opened.failures }
}
