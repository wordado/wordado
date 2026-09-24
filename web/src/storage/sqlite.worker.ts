import { openFirst } from './open'
import type { OpenResult, WorkerCall, WorkerRequest, WorkerResponse } from './protocol'
import { allRows, openIdb, openMemory, openOpfs, type Connection } from './waSqlite'

const scope = self as unknown as DedicatedWorkerGlobalScope
let connection: Connection | null = null

function open(): Connection {
  if (!connection) throw new Error('The database is not open')
  return connection
}

async function handle(call: WorkerCall): Promise<unknown> {
  switch (call.op) {
    case 'open': {
      if (connection) throw new Error('The database is already open')
      const opened = await openFirst(call.file, call.backends, { opfs: openOpfs, idb: openIdb, memory: openMemory })
      connection = opened.connection
      await connection.api.exec(connection.db, 'PRAGMA foreign_keys = ON')
      const result: OpenResult = { backend: opened.backend, failures: opened.failures }
      return result
    }
    case 'exec': {
      const c = open()
      await c.api.exec(c.db, call.sql)
      return null
    }
    case 'run':
      await allRows(open(), call.sql, call.params)
      return null
    case 'all':
      return allRows(open(), call.sql, call.params)
    case 'close': {
      const c = open()
      connection = null
      await c.api.close(c.db)
      return null
    }
  }
}

// One request at a time, in arrival order: the SqlDriver contract (plan 4).
let queue: Promise<void> = Promise.resolve()

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, ...call } = event.data
  queue = queue
    .then(async () => {
      let response: WorkerResponse
      try {
        response = { id, ok: true, value: await handle(call as WorkerCall) }
      } catch (err) {
        response = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      try {
        scope.postMessage(response)
      } catch (err) {
        // e.g. a DataCloneError on the reply itself: the caller still gets an answer, and the queue keeps going.
        scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
    // A request must never leave the queue chain rejected: that would hang every later request.
    .catch(() => undefined)
}
