import * as SQLite from '@journeyapps/wa-sqlite'
import SQLiteAsyncFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs'
import SQLiteSyncFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs'
import { IDBBatchAtomicVFS } from '@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js'
import { OPFSCoopSyncVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js'
import type { SqlValue } from '@wordado/client-data'
import { isUnsupportedError, StorageUnavailable } from './open'

/** One open database. Runs inside the Worker only. */
export interface Connection {
  readonly api: SQLiteAPI
  readonly db: number
}

// The package's declaration of IDBBatchAtomicVFS predates its async `create`.
const IdbVfs = IDBBatchAtomicVFS as unknown as { create(name: string, module: unknown): Promise<SQLiteVFS> }

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Creating the VFS touches the real storage (OPFS lists the root directory,
 * takes a Web Lock and opens sync access handles; IndexedDB opens and can
 * upgrade the learner's database), so most of its errors are real failures
 * to open, not an unsupported browser. Only `isUnsupportedError` becomes a
 * `StorageUnavailable`; everything else — quota, corruption, a held lock —
 * propagates and stops `openFirst` from falling back onto an empty database.
 */
async function vfs(what: string, create: () => Promise<SQLiteVFS>): Promise<SQLiteVFS> {
  try {
    return await create()
  } catch (err) {
    if (isUnsupportedError(err)) throw new StorageUnavailable(`${what}: ${messageOf(err)}`)
    throw err
  }
}

/** OPFS with synchronous access handles: the fastest, and Worker-only (spec §9.1). */
export async function openOpfs(file: string): Promise<Connection> {
  if (typeof navigator.storage?.getDirectory !== 'function') throw new StorageUnavailable('OPFS is not available')
  if (typeof navigator.locks === 'undefined') throw new StorageUnavailable('Web Locks are not available')
  if (typeof FileSystemFileHandle === 'undefined' || !('createSyncAccessHandle' in FileSystemFileHandle.prototype)) {
    throw new StorageUnavailable('OPFS sync access handles are not available')
  }
  const module = await SQLiteSyncFactory()
  const api = SQLite.Factory(module)
  api.vfs_register(await vfs('OPFS', () => OPFSCoopSyncVFS.create('opfs', module)), true)
  return { api, db: await api.open_v2(`${file}.sqlite`) }
}

/** IndexedDB, for browsers without OPFS: slower, with the same guarantees (spec §9.1). */
export async function openIdb(file: string): Promise<Connection> {
  if (typeof indexedDB === 'undefined') throw new StorageUnavailable('IndexedDB is not available')
  const module = await SQLiteAsyncFactory()
  const api = SQLite.Factory(module)
  api.vfs_register(await vfs('IndexedDB', () => IdbVfs.create(`wordado-${file}`, module)), true)
  return { api, db: await api.open_v2(`${file}.sqlite`) }
}

/** The last resort: nothing survives the tab (spec §9.1). */
export async function openMemory(): Promise<Connection> {
  const module = await SQLiteSyncFactory()
  const api = SQLite.Factory(module)
  return { api, db: await api.open_v2(':memory:') }
}

/** Runs one or more statements with positional parameters; returns the rows of all of them. */
export async function allRows(c: Connection, sql: string, params: readonly SqlValue[]): Promise<Record<string, SqlValue>[]> {
  const rows: Record<string, SqlValue>[] = []
  for await (const stmt of c.api.statements(c.db, sql)) {
    if (params.length > 0) c.api.bind_collection(stmt, [...params])
    const columns = c.api.column_names(stmt)
    while ((await c.api.step(stmt)) === SQLite.SQLITE_ROW) {
      const values = c.api.row(stmt)
      rows.push(Object.fromEntries(columns.map((name, i) => [name, (values[i] ?? null) as SqlValue])))
    }
  }
  return rows
}
