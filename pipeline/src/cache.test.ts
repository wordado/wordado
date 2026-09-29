import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cachedBatch, cacheKey, OfflineMiss, StageCache } from './cache'

const file = () => join(mkdtempSync(join(tmpdir(), 'cache-')), 'stage.jsonl')

describe('StageCache', () => {
  it('keeps each result the moment it arrives, so a reopened cache has it', () => {
    const f = file()
    StageCache.open(f).set('k', { a: 1 })
    const again = StageCache.open(f)
    expect(again.has('k')).toBe(true)
    expect(again.get('k')).toEqual({ a: 1 })
  })

  it('keys by stage, prompt version and canonical input, not key order', () => {
    expect(cacheKey('s', 1, { a: 1, b: 2 })).toBe(cacheKey('s', 1, { b: 2, a: 1 }))
    expect(cacheKey('s', 2, { a: 1 })).not.toBe(cacheKey('s', 1, { a: 1 }))
  })
})

describe('cachedBatch', () => {
  const run = (calls: string[][]) => async (batch: readonly string[]) => {
    calls.push([...batch])
    return batch.map((w) => w.toUpperCase())
  }

  it('asks only for the misses, in batches, and returns results in item order', async () => {
    const cache = StageCache.open(file())
    const calls: string[][] = []
    const opts = { cache, stage: 's', version: 1, keyInput: (w: string) => w, batchSize: 2, concurrency: 1, offline: false }
    expect(await cachedBatch({ ...opts, items: ['a', 'b', 'c'], run: run(calls) })).toEqual(['A', 'B', 'C'])
    expect(await cachedBatch({ ...opts, items: ['c', 'd', 'a'], run: run(calls) })).toEqual(['C', 'D', 'A'])
    expect(calls).toEqual([['a', 'b'], ['c'], ['d']])
  })

  it('records which model answered each item, beside the answer, not in the key', async () => {
    const f = file()
    const opts = { cache: StageCache.open(f), stage: 's', version: 1, keyInput: (w: string) => w, batchSize: 2, concurrency: 1, offline: false }
    await cachedBatch({ ...opts, items: ['a'], model: 'claude-code:claude-sonnet-5', run: run([]) })
    expect(readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as unknown)).toEqual([
      { key: cacheKey('s', 1, 'a'), value: 'A', model: 'claude-code:claude-sonnet-5' },
    ])
  })

  it('offline, names how many items are missing instead of calling out', async () => {
    const cache = StageCache.open(file())
    const calls: string[][] = []
    const opts = { cache, stage: 'senses', version: 1, keyInput: (w: string) => w, batchSize: 2, concurrency: 1, offline: true }
    await expect(cachedBatch({ ...opts, items: ['a', 'b'], run: run(calls) })).rejects.toThrow(OfflineMiss)
    await expect(cachedBatch({ ...opts, items: ['a', 'b'], run: run(calls) })).rejects.toThrow('senses: 2 items are not cached')
    expect(calls).toEqual([])
  })

  it('refuses a batch answer of the wrong length rather than shifting results onto other items', async () => {
    const cache = StageCache.open(file())
    const opts = { cache, stage: 's', version: 1, keyInput: (w: string) => w, batchSize: 2, concurrency: 1, offline: false }
    await expect(cachedBatch({ ...opts, items: ['a', 'b'], run: async () => ['A'] })).rejects.toThrow(/s: a batch of 2 came back with 1/)
  })

  it('a failed batch keeps the batches that finished before it', async () => {
    const f = file()
    const opts = { stage: 's', version: 1, keyInput: (w: string) => w, batchSize: 1, concurrency: 1, offline: false }
    await expect(
      cachedBatch({ ...opts, cache: StageCache.open(f), items: ['a', 'b'], run: async (b) => {
        if (b[0] === 'b') throw new Error('down')
        return ['A']
      } }),
    ).rejects.toThrow('down')
    expect(StageCache.open(f).size).toBe(1)
  })
})
