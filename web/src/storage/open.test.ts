import { describe, expect, it } from 'vitest'
import { isUnsupportedError, openFirst, StorageUnavailable } from './open'

const unsupported = (why: string) => async () => {
  throw new StorageUnavailable(why)
}

describe('openFirst', () => {
  it('opens the first storage the browser supports, and says why it skipped the others', async () => {
    const opened = await openFirst('demo', ['opfs', 'idb', 'memory'], {
      opfs: unsupported('no sync access handles'),
      idb: async (file) => `idb:${file}`,
      memory: async () => 'memory',
    })
    expect(opened).toEqual({ connection: 'idb:demo', backend: 'idb', failures: ['opfs: no sync access handles'] })
  })

  it('falls through to memory when nothing persistent is supported', async () => {
    const opened = await openFirst('demo', ['opfs', 'idb', 'memory'], {
      opfs: unsupported('no OPFS'),
      idb: unsupported('no IndexedDB'),
      memory: async () => 'memory',
    })
    expect(opened.backend).toBe('memory')
    expect(opened.failures).toHaveLength(2)
  })

  it('does not fall back when a supported storage fails to open: that would start an empty second database', async () => {
    await expect(
      openFirst('demo', ['opfs', 'memory'], {
        opfs: async () => {
          throw new Error('database disk image is malformed')
        },
        idb: async () => 'idb',
        memory: async () => 'memory',
      }),
    ).rejects.toThrow('malformed')
  })

  it('fails when every storage it may use is unsupported', async () => {
    await expect(openFirst('demo', ['opfs'], { opfs: unsupported('no OPFS'), idb: unsupported('x'), memory: unsupported('x') })).rejects.toThrow(
      'No storage could be opened (opfs: no OPFS)',
    )
  })
})

describe('isUnsupportedError', () => {
  it('treats a quota or corruption error as a real failure to open, never as unsupported', () => {
    expect(isUnsupportedError(new DOMException('quota exceeded', 'QuotaExceededError'))).toBe(false)
    expect(isUnsupportedError(new DOMException('corrupt', 'UnknownError'))).toBe(false)
  })

  it('treats SecurityError and NotSupportedError as unsupported', () => {
    expect(isUnsupportedError(new DOMException('blocked in this context', 'SecurityError'))).toBe(true)
    expect(isUnsupportedError(new DOMException('not supported', 'NotSupportedError'))).toBe(true)
  })

  it('treats a plain Error as a real failure, not unsupported', () => {
    expect(isUnsupportedError(new Error('database disk image is malformed'))).toBe(false)
  })
})
