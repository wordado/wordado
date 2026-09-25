import { StorageUnavailable } from './open'

/** The part of an OPFS directory handle the probe uses. */
export interface ProbeDirectory {
  getFileHandle(name: string, options?: { readonly create?: boolean }): Promise<{ createSyncAccessHandle(): Promise<{ close(): void }> }>
  removeEntry(name: string): Promise<void>
}

/** Created and removed again by every probe; not a `.sqlite` name, so `listDatabases` never sees it. */
export const PROBE_FILE = '.wordado-probe'

const describe = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}` : String(err))

/**
 * Whether OPFS can open a file here at all. Safari's private windows (and
 * Playwright's WebKit) offer OPFS but fail every `createSyncAccessHandle`
 * with `UnknownError`, which would otherwise read as a real failure and stop
 * the app (spec §9.1 wants IndexedDB then). Only probed while the learner has
 * no OPFS database: once one exists, falling back would open an empty second
 * database beside it, so its own open must report the failure instead.
 */
export async function checkOpfs(root: ProbeDirectory, file: string): Promise<void> {
  try {
    await root.getFileHandle(`${file}.sqlite`)
    return
  } catch {
    // Not there yet: probe.
  }
  try {
    const handle = await root.getFileHandle(PROBE_FILE, { create: true })
    const access = await handle.createSyncAccessHandle()
    access.close()
  } catch (err) {
    throw new StorageUnavailable(`OPFS cannot open files here (${describe(err)})`)
  } finally {
    await root.removeEntry(PROBE_FILE).catch(() => undefined)
  }
}
