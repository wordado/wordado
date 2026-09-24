import type { Backend } from './protocol'

/** A storage this browser does not support. The only failure that moves on to the next storage. */
export class StorageUnavailable extends Error {}

/**
 * Opens `file` on the first supported storage of `backends`. A storage that
 * is supported but fails to open is an error: falling back would open an
 * empty second database beside the learner's real one.
 */
export async function openFirst<C>(
  file: string,
  backends: readonly Backend[],
  openers: Readonly<Record<Backend, (file: string) => Promise<C>>>,
): Promise<{ connection: C; backend: Backend; failures: string[] }> {
  const failures: string[] = []
  for (const backend of backends) {
    try {
      return { connection: await openers[backend](file), backend, failures }
    } catch (err) {
      if (!(err instanceof StorageUnavailable)) throw err
      failures.push(`${backend}: ${err.message}`)
    }
  }
  throw new Error(`No storage could be opened (${failures.join('; ')})`)
}
