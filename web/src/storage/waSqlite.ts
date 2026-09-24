import * as SQLite from '@journeyapps/wa-sqlite'
import SQLiteAsyncFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs'
import SQLiteSyncFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs'
import { IDBBatchAtomicVFS } from '@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js'
import { OPFSCoopSyncVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js'
import type { SqlValue } from '@wordado/client-data'
import { StorageUnavailable } from './open'

/** One open database. Runs inside the Worker only. */
export interface Connection {
  readonly api: SQLiteAPI
  readonly db: number
}

// The package's declaration of IDBBatchAtomicVFS predates its async `create`.
const IdbVfs = IDBBatchAtomicVFS as unknown as { create(name: string, module: unknown): Promise<SQLiteVFS> }

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Creating the VFS is where an unsupported storage shows itself; anything after that is a real error. */
async function vfs(what: string, create: () => Promise<SQLiteVFS>): Promise<SQLiteVFS> {
  try {
    return await create()
  } catch (err) {
    throw new StorageUnavailable(`${what}: ${messageOf(err)}`)
  }
}

/** OPFS with synchronous access handles: the fastest, and Worker-only (spec §9.1). */
export async function openOpfs(file: string): Promise<Connection> {
  if (typeof navigator.storage?.getDirectory !== 'function') throw new StorageUnavailable('OPFS is not available')
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
