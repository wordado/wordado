import { describe, expect, it } from 'vitest'
import { StorageUnavailable } from './open'
import { checkOpfs, opfsRoot, PROBE_FILE, type ProbeDirectory } from './opfsProbe'

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

  it('rethrows a lookup that fails for another reason than NotFoundError, so an existing OPFS database is never abandoned', async () => {
    const d = directory([])
    const failure = new DOMException('The operation failed for an unknown transient reason', 'UnknownError')
    const root: ProbeDirectory = {
      getFileHandle: async (name, options) => {
        if (name === 'demo.sqlite') throw failure
        return d.root.getFileHandle(name, options)
      },
      removeEntry: d.root.removeEntry,
    }
    const err = await checkOpfs(root, 'demo').catch((e: unknown) => e)
    expect(err).toBe(failure)
    expect(err).not.toBeInstanceOf(StorageUnavailable)
    expect(d.present.has(PROBE_FILE)).toBe(false)
    expect(d.removed).toEqual([])
  })
})

describe('checkOpfs stays on IndexedDB once the learner’s file lives there', () => {
  /** An IndexedDB lookup that holds `names` and records what it was asked. */
  function idb(names: string[]) {
    const asked: string[] = []
    const has = async (name: string) => {
      asked.push(name)
      return names.includes(name)
    }
    return { has, asked }
  }

  it('reports OPFS as unavailable when IndexedDB holds the file and OPFS does not', async () => {
    const d = directory([])
    const i = idb(['wordado-demo'])
    const err = await checkOpfs(d.root, 'demo', i.has).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StorageUnavailable)
    expect((err as Error).message).toContain('already kept in IndexedDB')
    expect(i.asked).toEqual(['wordado-demo'])
    expect(d.removed).toEqual([])
  })

  it('probes as before when neither holds the file', async () => {
    const d = directory([])
    const i = idb(['wordado-other'])
    await expect(checkOpfs(d.root, 'demo', i.has)).resolves.toBeUndefined()
    expect(i.asked).toEqual(['wordado-demo'])
    expect(d.removed).toEqual([PROBE_FILE])
  })

  it('opens OPFS without asking IndexedDB when OPFS holds the file', async () => {
    const d = directory(['demo.sqlite'])
    const i = idb(['wordado-demo'])
    await expect(checkOpfs(d.root, 'demo', i.has)).resolves.toBeUndefined()
    expect(i.asked).toEqual([])
  })
})

describe('opfsRoot (WebKit can reject navigator.storage.getDirectory() itself, not only createSyncAccessHandle)', () => {
  it('passes a resolved directory through', async () => {
    const d = directory([])
    await expect(opfsRoot(async () => d.root)).resolves.toBe(d.root)
  })

  it('turns a rejection with UnknownError into StorageUnavailable', async () => {
    const err = await opfsRoot(() => Promise.reject(new DOMException('nope', 'UnknownError'))).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StorageUnavailable)
    expect((err as Error).message).toContain('UnknownError')
  })

  it('turns a SecurityError into StorageUnavailable too', async () => {
    const err = await opfsRoot(() => Promise.reject(new DOMException('nope', 'SecurityError'))).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StorageUnavailable)
    expect((err as Error).message).toContain('SecurityError')
  })
})
