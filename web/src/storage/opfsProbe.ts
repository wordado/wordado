import { IDB_PREFIX } from './erase'
import { StorageUnavailable } from './open'

/** The part of an OPFS directory handle the probe uses. */
export interface ProbeDirectory {
  getFileHandle(name: string, options?: { readonly create?: boolean }): Promise<{ createSyncAccessHandle(): Promise<{ close(): void }> }>
  removeEntry(name: string): Promise<void>
}

/** Created and removed again by every probe; not a `.sqlite` name, so `listDatabases` never sees it. */
export const PROBE_FILE = '.wordado-probe'

const nameOf = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}` : String(err))

/**
 * Reaches the OPFS root, or reports it as unavailable. Safari's private
 * windows, and Playwright's WebKit, can reject `navigator.storage.getDirectory()`
 * itself with `UnknownError` — not only `createSyncAccessHandle` — and a
 * `SecurityError` there means the same thing the rest of this file already
 * treats it as. Either way, a directory that cannot be reached holds no OPFS
 * database of the learner's to abandon, so this always falls back to
 * IndexedDB rather than only for the errors `isUnsupportedError` recognises.
 */
export async function opfsRoot(getDirectory: () => Promise<ProbeDirectory>): Promise<ProbeDirectory> {
  try {
    return await getDirectory()
  } catch (err) {
    throw new StorageUnavailable(`OPFS: ${nameOf(err)}`)
  }
}

/** Whether IndexedDB already holds a database by this name; never throws. */
export type IdbHas = (name: string) => Promise<boolean>

const isNotFound = (err: unknown): boolean => err instanceof Error && err.name === 'NotFoundError'

/**
 * Whether OPFS can open a file here at all. Safari's private windows (and
 * Playwright's WebKit) offer OPFS but fail every `createSyncAccessHandle`
 * with `UnknownError`, which would otherwise read as a real failure and stop
 * the app (spec §9.1 wants IndexedDB then). Only probed while the learner has
 * no OPFS database: once one exists, falling back would open an empty second
 * database beside it, so its own open must report the failure instead. For
 * the same reason only a `NotFoundError` means the file is absent; any other
 * failure to look it up is a real failure to open, not a missing OPFS.
 *
 * A learner whose file already lives in IndexedDB stays there. A probe that
 * failed once (a private window, a transient error) sent them to IndexedDB;
 * opening OPFS on a later visit would start an empty database and hide the
 * one that holds their progress, so this reports OPFS as unavailable before
 * probing and `openFirst` moves on to IndexedDB.
 */
export async function checkOpfs(root: ProbeDirectory, file: string, idbHas: IdbHas = async () => false): Promise<void> {
  try {
    await root.getFileHandle(`${file}.sqlite`)
    return
  } catch (err) {
    if (!isNotFound(err)) throw err
  }
  if (await idbHas(`${IDB_PREFIX}${file}`)) throw new StorageUnavailable(`OPFS: ${file} is already kept in IndexedDB`)
  try {
    const handle = await root.getFileHandle(PROBE_FILE, { create: true })
    const access = await handle.createSyncAccessHandle()
    access.close()
  } catch (err) {
    throw new StorageUnavailable(`OPFS cannot open files here (${nameOf(err)})`)
  } finally {
    await root.removeEntry(PROBE_FILE).catch(() => undefined)
  }
}
