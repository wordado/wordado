import { describe, expect, it } from 'vitest'
import { StorageUnavailable } from './open'
import { checkOpfs, opfsRoot, PROBE_PREFIX, type ProbeDirectory, type ProbeLocks } from './opfsProbe'

/**
 * An OPFS root holding `files`, whose sync access handles fail with `failure` when given. Like
 * OPFS, it refuses a second access handle on a file while one is open, and refuses to remove a
 * file with an open handle; an access handle is only granted a tick after it is asked for, so
 * probes running at once overlap as they do in a browser.
 */
function directory(files: string[], failure?: string) {
  const present = new Set(files)
  const open = new Set<string>()
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
          if (open.has(name)) throw new DOMException('Access Handles cannot be created if there is another open Access Handle', 'NoModificationAllowedError')
          if (!present.has(name)) throw new DOMException('A requested file or directory could not be found', 'NotFoundError')
          open.add(name)
          await new Promise((resolve) => setTimeout(resolve, 0))
          return { close: () => void open.delete(name) }
        },
      }
    },
    removeEntry: async (name) => {
      if (open.has(name)) throw new DOMException('An open Access Handle holds the file', 'NoModificationAllowedError')
      if (!present.delete(name)) throw new DOMException('A requested file or directory could not be found', 'NotFoundError')
      removed.push(name)
    },
    keys: async function* () {
      yield* present
    },
  }
  return { root, present, removed }
}

/** Web Locks as the probe uses them: exclusive, with `ifAvailable`. */
function lockManager() {
  const held = new Set<string>()
  const waiting = new Map<string, (() => void)[]>()
  const locks: ProbeLocks = {
    request: async (name, options, task) => {
      if (held.has(name)) {
        if (options.ifAvailable) return task(null)
        await new Promise<void>((resolve) => waiting.set(name, [...(waiting.get(name) ?? []), resolve]))
      }
      held.add(name)
      try {
        return await task({ name })
      } finally {
        held.delete(name)
        const next = waiting.get(name)?.shift()
        next?.()
      }
    },
  }
  return { locks, held }
}

const probes = (present: Iterable<string>) => [...present].filter((name) => name.startsWith(PROBE_PREFIX))

describe('checkOpfs (spec §9.1: OPFS, then IndexedDB)', () => {
  it('passes where a file opens, and leaves no probe behind', async () => {
    const d = directory([])
    await expect(checkOpfs(d.root, 'demo')).resolves.toBeUndefined()
    expect(probes(d.present)).toEqual([])
  })

  it('reports OPFS as unavailable when no file can be opened and the learner has none there (Safari private windows)', async () => {
    const d = directory([], 'UnknownError')
    const err = await checkOpfs(d.root, 'demo').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StorageUnavailable)
    expect((err as Error).message).toContain('UnknownError')
    expect(probes(d.present)).toEqual([])
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
      keys: d.root.keys,
    }
    const err = await checkOpfs(root, 'demo').catch((e: unknown) => e)
    expect(err).toBe(failure)
    expect(err).not.toBeInstanceOf(StorageUnavailable)
    expect(probes(d.present)).toEqual([])
    expect(d.removed).toEqual([])
  })
})

describe('checkOpfs when several probe at once (two tabs, or two test files, opening at the same time)', () => {
  it('lets two probes run at once without failing either, and leaves no probe behind', async () => {
    const d = directory([])
    const { locks } = lockManager()
    const results = await Promise.allSettled([checkOpfs(d.root, 'demo', undefined, locks), checkOpfs(d.root, 'user-u1', undefined, locks)])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(probes(d.present)).toEqual([])
    expect(probes(d.removed)).toHaveLength(2)
  })

  it('probes without Web Locks too, with the same result', async () => {
    const d = directory([])
    const results = await Promise.allSettled([checkOpfs(d.root, 'demo'), checkOpfs(d.root, 'user-u1')])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(probes(d.present)).toEqual([])
  })

  it('removes a probe a crashed tab left behind, but not one another tab is probing with, nor anything else', async () => {
    const stale = `${PROBE_PREFIX}crashed`
    const live = `${PROBE_PREFIX}live`
    const d = directory([stale, live, 'user-u1.sqlite', '.wordado-probe'])
    const { locks, held } = lockManager()
    held.add(live)
    await expect(checkOpfs(d.root, 'demo', undefined, locks)).resolves.toBeUndefined()
    expect(d.present.has(stale)).toBe(false)
    expect(d.present.has(live)).toBe(true)
    expect(d.present.has('user-u1.sqlite')).toBe(true)
    expect(probes(d.present)).toEqual([live])
  })

  it('leaves stale probes alone without Web Locks, since it cannot tell them from live ones', async () => {
    const stale = `${PROBE_PREFIX}crashed`
    const d = directory([stale])
    await expect(checkOpfs(d.root, 'demo')).resolves.toBeUndefined()
    expect(probes(d.present)).toEqual([stale])
  })

  it('still probes when the sweep of stale probes fails', async () => {
    const d = directory([`${PROBE_PREFIX}crashed`])
    const { locks } = lockManager()
    const root: ProbeDirectory = {
      ...d.root,
      keys: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new DOMException('listing failed', 'UnknownError')) }),
      }),
    }
    await expect(checkOpfs(root, 'demo', undefined, locks)).resolves.toBeUndefined()
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
    expect(probes(d.removed)).toHaveLength(1)
    expect(d.removed).toEqual(probes(d.removed))
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
