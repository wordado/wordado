import { isUnsupportedError } from './open'

/** The OPFS entries one SQLite file leaves: `<file>.sqlite` and anything `<file>.sqlite-…` (journals). */
const belongsTo = (file: string, name: string) => name === `${file}.sqlite` || name.startsWith(`${file}.sqlite-`)

async function removeFromOpfs(file: string): Promise<void> {
  if (typeof navigator.storage?.getDirectory !== 'function') return
  let root: FileSystemDirectoryHandle
  try {
    root = await navigator.storage.getDirectory()
  } catch (err) {
    if (isUnsupportedError(err)) return
    throw err
  }
  const names: string[] = []
  // FileSystemDirectoryHandle is async-iterable; the DOM lib in use does not type `keys()` yet.
  for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) if (belongsTo(file, name)) names.push(name)
  for (const name of names) await root.removeEntry(name, { recursive: true })
}

function removeFromIdb(name: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error(`${name} could not be deleted`))
    // `blocked` means a connection is still open. The Worker that held it is terminated on close,
    // so the deletion goes on to `success` once the browser notices; nothing to do but wait.
  })
}

/**
 * Deletes a database file wherever it may live (spec §8.6): OPFS and
 * IndexedDB (6a's `openIdb` names it `wordado-<file>`). Run it only with
 * the file closed: an open access handle makes OPFS refuse. Deleting a file
 * that does not exist does nothing.
 */
export async function deleteDatabase(file: string): Promise<void> {
  await removeFromOpfs(file)
  await removeFromIdb(`wordado-${file}`)
}
