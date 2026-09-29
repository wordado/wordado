import { canonicalJson } from '@wordado/core'
import { sha256Hex } from './checksum'
import { appendJsonl, readJsonl } from './files'
import { mapLimit } from './mapLimit'

interface Line {
  readonly key: string
  readonly value: unknown
  /** Which model answered: `anthropic/claude-sonnet-5` through OpenRouter, `claude-code:claude-sonnet-5` on a Claude plan. */
  readonly model?: string
}

/**
 * One stage's results, one JSONL line per item, in the content repository
 * (Decision 17). A line is appended the moment its batch returns, so a crash
 * or a budget stop loses nothing already paid for (Review Focus 2).
 */
export class StageCache {
  private readonly map: Map<string, unknown>
  private constructor(private readonly file: string, lines: readonly Line[]) {
    this.map = new Map(lines.map((l) => [l.key, l.value]))
  }
  static open(file: string): StageCache {
    return new StageCache(file, readJsonl<Line>(file))
  }
  get size(): number {
    return this.map.size
  }
  has(key: string): boolean {
    return this.map.has(key)
  }
  get(key: string): unknown {
    return this.map.get(key)
  }
  set(key: string, value: unknown, model?: string): void {
    this.map.set(key, value)
    appendJsonl(this.file, [{ key, value, ...(model ? { model } : {}) }])
  }
}

/** The model is not part of the key: changing it keeps reviewed proposals; bumping a prompt version does not. */
export function cacheKey(stage: string, version: number, input: unknown): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson([stage, version, input])))
}

export class OfflineMiss extends Error {
  readonly stage: string
  readonly missing: number
  constructor(stage: string, missing: number) {
    super(`${stage}: ${missing} items are not cached; run \`corpus draft\` with OPENROUTER_API_KEY first`)
    this.name = 'OfflineMiss'
    this.stage = stage
    this.missing = missing
  }
}

export interface CachedBatchOptions<I, O> {
  readonly cache: StageCache
  readonly stage: string
  readonly version: number
  readonly items: readonly I[]
  readonly keyInput: (item: I) => unknown
  readonly batchSize: number
  readonly concurrency: number
  /** Release runs offline: every item must already be cached. */
  readonly offline: boolean
  /** Recorded with each answer (provenance); not part of the key. */
  readonly model?: string
  readonly run: (batch: readonly I[]) => Promise<readonly O[]>
}

/** Results for every item in item order, asking `run` only for cache misses, `batchSize` at a time. */
export async function cachedBatch<I, O>(opts: CachedBatchOptions<I, O>): Promise<O[]> {
  const keys = opts.items.map((item) => cacheKey(opts.stage, opts.version, opts.keyInput(item)))
  const missing: number[] = []
  const seen = new Set<string>()
  keys.forEach((k, i) => {
    if (!opts.cache.has(k) && !seen.has(k)) {
      seen.add(k)
      missing.push(i)
    }
  })
  if (missing.length > 0 && opts.offline) throw new OfflineMiss(opts.stage, missing.length)
  const batches: number[][] = []
  for (let i = 0; i < missing.length; i += opts.batchSize) batches.push(missing.slice(i, i + opts.batchSize))
  await mapLimit(batches, opts.concurrency, async (batch) => {
    const out = await opts.run(batch.map((i) => opts.items[i]!))
    if (out.length !== batch.length) throw new Error(`${opts.stage}: a batch of ${batch.length} came back with ${out.length}`)
    batch.forEach((i, j) => opts.cache.set(keys[i]!, out[j], opts.model))
  })
  return keys.map((k) => opts.cache.get(k) as O)
}
