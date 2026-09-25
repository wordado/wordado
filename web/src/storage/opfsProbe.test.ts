import { describe, expect, it } from 'vitest'
import { StorageUnavailable } from './open'
import { checkOpfs, PROBE_FILE, type ProbeDirectory } from './opfsProbe'

/** An OPFS root holding `files`, whose sync access handles fail with `failure` when given. */
function directory(files: string[], failure?: string) {
  const present = new Set(files)
  const removed: string[] = []
  const root: ProbeDirectory = {
    getFileHandle: async (name, options) => {
      if (!present.has(name)) {
        if (!options?.create) throw new DOMException('A requested file or directory could not be found', 'NotFoundError')
        present.add(name)
      }
      return {
        createSyncAccessHandle: async () => {
          if (failure) throw new DOMException('The operation failed for an unknown transient reason', failure)
          return { close: () => undefined }
        },
      }
    },
    removeEntry: async (name) => {
      present.delete(name)
      removed.push(name)
    },
  }
  return { root, present, removed }
}

describe('checkOpfs (spec §9.1: OPFS, then IndexedDB)', () => {
  it('passes where a file opens, and leaves no probe behind', async () => {
    const d = directory([])
    await expect(checkOpfs(d.root, 'demo')).resolves.toBeUndefined()
    expect(d.present.has(PROBE_FILE)).toBe(false)
  })

  it('reports OPFS as unavailable when no file can be opened and the learner has none there (Safari private windows)', async () => {
    const d = directory([], 'UnknownError')
    const err = await checkOpfs(d.root, 'demo').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StorageUnavailable)
    expect((err as Error).message).toContain('UnknownError')
    expect(d.present.has(PROBE_FILE)).toBe(false)
  })

  it('never gives up on an OPFS database that already exists: its own open reports the failure instead', async () => {
    const d = directory(['demo.sqlite'], 'UnknownError')
    await expect(checkOpfs(d.root, 'demo')).resolves.toBeUndefined()
    expect(d.removed).toEqual([])
  })

  it('probes for the learner’s own file, not another one', async () => {
    const d = directory(['demo.sqlite'], 'UnknownError')
    await expect(checkOpfs(d.root, 'user-u1')).rejects.toBeInstanceOf(StorageUnavailable)
  })
})
