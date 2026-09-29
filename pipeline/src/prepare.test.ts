import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { parquetWriteFile } from 'hyparquet-writer'
import { describe, expect, it } from 'vitest'
import { parseFrequencyList } from './frequency'
import { countInto, countParquet, parquetTexts, pruneRare, streamed, sumGoogleBooks, writeCounts } from './prepare'

const tmp = () => mkdtempSync(join(tmpdir(), 'prepare-'))

interface Served {
  readonly base: string
  /** The byte ranges asked for, in order. */
  readonly ranges: string[]
  close(): Promise<void>
}

/**
 * Serves files as Hugging Face and Google's storage do: HEAD gives the size, GET honours Range, and a whole file comes
 * in small chunks, as a slow download would bring it. `/broken.gz` sends half of `broken.gz`, then drops the connection.
 */
async function serve(files: Readonly<Record<string, Uint8Array>>): Promise<Served> {
  const ranges: string[] = []
  const server: Server = createServer((req, res) => {
    const name = (req.url ?? '').slice(1)
    const bytes = files[name]
    if (!bytes) return void res.writeHead(404).end()
    if (name === 'broken.gz') {
      // The response has begun, half the body is on its way, and then the connection drops.
      res.writeHead(200, { 'content-length': bytes.length })
      res.flushHeaders()
      res.write(bytes.subarray(0, bytes.length >> 1))
      return void setTimeout(() => res.destroy(), 50)
    }
    if (req.method === 'HEAD') return void res.writeHead(200, { 'content-length': bytes.length, 'accept-ranges': 'bytes' }).end()
    const range = /bytes=(\d+)-(\d+)?/.exec(req.headers.range ?? '')
    if (range) {
      ranges.push(range[0])
      const start = Number(range[1])
      const end = range[2] === undefined ? bytes.length - 1 : Number(range[2])
      return void res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': end - start + 1 }).end(bytes.subarray(start, end + 1))
    }
    res.writeHead(200, { 'content-length': bytes.length })
    for (let i = 0; i < bytes.length; i += 7) res.write(bytes.subarray(i, i + 7))
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    ranges,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/** A Parquet file's bytes (written through a scratch file: the writer takes a filename). */
async function parquetBytes(columnData: Parameters<typeof parquetWriteFile>[0]['columnData'], rowGroupSize?: number): Promise<Uint8Array> {
  const file = join(tmp(), 'shard.parquet')
  await parquetWriteFile({ filename: file, columnData, ...(rowGroupSize ? { rowGroupSize } : {}) })
  return readFileSync(file)
}

describe('countInto', () => {
  it('counts word forms as the frequency lists do: lowercased, apostrophes kept inside a word, hyphens split', () => {
    const counts = new Map<string, number>()
    countInto(counts, 'Don’t stop! The well-known CAFÉ, the café. 42')
    expect([...counts]).toEqual([["don't", 1], ['stop', 1], ['the', 2], ['well', 1], ['known', 1], ['café', 2]])
  })
})

describe('streamed', () => {
  it('takes http(s) URLs only: a local file is refused, so no downloaded corpus is ever counted (licence review, question 8)', async () => {
    expect(() => streamed(['https://example.org/a.parquet', 'http://localhost:8000/b.gz'])).not.toThrow()
    expect(() => streamed(['https://example.org/a.parquet', '/tmp/shard.parquet'])).toThrow(/\/tmp\/shard.parquet: counting reads only http\(s\) URLs/)
    await expect(countParquet(['shard.parquet'])).rejects.toThrow(/only http\(s\) URLs/)
    await expect(sumGoogleBooks(['1-00000-of-00004.gz'], 2000, 2019)).rejects.toThrow(/only http\(s\) URLs/)
  })
})

describe('parquetTexts and countParquet', () => {
  it('reads the text column of every row group, in order, by byte ranges, and counts it', async () => {
    const bytes = await parquetBytes(
      [
        { name: 'text', data: ['a b', 'b', 'c c c', 'd', 'e'], type: 'STRING' },
        { name: 'id', data: ['1', '2', '3', '4', '5'], type: 'STRING' },
      ],
      2,
    )
    const server = await serve({ 'shard.parquet': bytes })
    try {
      const url = `${server.base}/shard.parquet`
      const texts: string[] = []
      for await (const t of parquetTexts(url)) texts.push(t)
      expect(texts).toEqual(['a b', 'b', 'c c c', 'd', 'e'])
      expect(server.ranges.length).toBeGreaterThan(0)
      expect(Object.fromEntries(await countParquet([url]))).toEqual({ a: 1, b: 2, c: 3, d: 1, e: 1 })
    } finally {
      await server.close()
    }
  })

  it('keeps the word table bounded by dropping rare forms, while frequent ones keep their counts', async () => {
    const rare = Array.from({ length: 40 }, (_, i) => `rare${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`)
    const server = await serve({ 'shard.parquet': await parquetBytes([{ name: 'text', data: ['the the the', ...rare, 'the cat cat'], type: 'STRING' }]) })
    try {
      const counts = await countParquet([`${server.base}/shard.parquet`], undefined, { maxForms: 10 })
      expect(counts.size).toBeLessThanOrEqual(10)
      expect(counts.get('the')).toBe(4)
      expect(counts.get('cat')).toBe(2)
    } finally {
      await server.close()
    }
  })
})

describe('pruneRare', () => {
  it('drops the forms seen least often, raising the floor until the table is at most half the limit', () => {
    const counts = new Map([['a', 5], ['b', 1], ['c', 1], ['d', 2], ['e', 1], ['f', 2]])
    pruneRare(counts, 3)
    expect(Object.fromEntries(counts)).toEqual({ a: 5 })
    const more = new Map([['a', 5], ['b', 1], ['d', 2]])
    pruneRare(more, 4)
    expect(Object.fromEntries(more)).toEqual({ a: 5, d: 2 })
  })
})

describe('sumGoogleBooks', () => {
  it('adds up the years asked for, folds case, and skips part-of-speech tagged forms, decompressing as the file arrives', async () => {
    const lines = ['Water\t1999,5,1\t2000,3,1\t2019,4,2\t2020,9,9', 'water\t2010,1,1', 'water_NOUN\t2005,100,1', 'the\t2005,10,1', 'old\t1990,7,1']
    const body = gzipSync(`${lines.join('\n')}\n`)
    const server = await serve({ '1-00000-of-00004.gz': body, 'broken.gz': body })
    try {
      const url = `${server.base}/1-00000-of-00004.gz`
      const seen: [string, number][] = []
      expect(Object.fromEntries(await sumGoogleBooks([url], 2000, 2019, (source, n) => seen.push([source, n])))).toEqual({ water: 8, the: 10 })
      expect(seen).toEqual([[url, 5]])
    } finally {
      await server.close()
    }
  })

  it('fails on a missing file or a dropped connection instead of crashing or hanging', async () => {
    // Varied lines, so the compressed file is large enough to arrive in more than one piece.
    const lines = Array.from({ length: 5000 }, (_, i) => `w${(i * 7919) % 100003}\t2005,${i},1`).join('\n')
    const server = await serve({ 'broken.gz': gzipSync(`${lines}\n`) })
    try {
      await expect(sumGoogleBooks([`${server.base}/missing.gz`], 2000, 2019)).rejects.toThrow(/HTTP 404/)
      await expect(sumGoogleBooks([`${server.base}/broken.gz`], 2000, 2019)).rejects.toThrow()
    } finally {
      await server.close()
    }
  })
})

describe('writeCounts', () => {
  it('writes the most frequent forms first, ties by form, in a file parseFrequencyList reads back', () => {
    const file = join(tmp(), 'sources', 'x.tsv')
    expect(writeCounts(file, new Map([['b', 2], ['a', 2], ['c', 5], ['d', 1]]), { top: 3, comment: 'test counts' })).toBe(3)
    const text = readFileSync(file, 'utf8')
    expect(text).toBe('# test counts\nform\tcount\nc\t5\na\t2\nb\t2\n')
    expect([...parseFrequencyList(text, 'x')]).toEqual([['c', 5], ['a', 2], ['b', 2]])
  })
})
