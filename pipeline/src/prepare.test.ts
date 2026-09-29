import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { parquetWriteFile } from 'hyparquet-writer'
import { describe, expect, it } from 'vitest'
import { parseFrequencyList } from './frequency'
import { countInto, countParquet, parquetTexts, pruneRare, sumGoogleBooks, writeCounts } from './prepare'

const tmp = () => mkdtempSync(join(tmpdir(), 'prepare-'))

describe('countInto', () => {
  it('counts word forms as the frequency lists do: lowercased, apostrophes kept inside a word, hyphens split', () => {
    const counts = new Map<string, number>()
    countInto(counts, 'Don’t stop! The well-known CAFÉ, the café. 42')
    expect([...counts]).toEqual([["don't", 1], ['stop', 1], ['the', 2], ['well', 1], ['known', 1], ['café', 2]])
  })
})

describe('parquetTexts and countParquet', () => {
  it('reads the text column of every row group, in order, and counts it', async () => {
    const file = join(tmp(), 'shard.parquet')
    await parquetWriteFile({
      filename: file,
      columnData: [
        { name: 'text', data: ['a b', 'b', 'c c c', 'd', 'e'], type: 'STRING' },
        { name: 'id', data: ['1', '2', '3', '4', '5'], type: 'STRING' },
      ],
      rowGroupSize: 2,
    })
    const texts: string[] = []
    for await (const t of parquetTexts(file)) texts.push(t)
    expect(texts).toEqual(['a b', 'b', 'c c c', 'd', 'e'])
    expect(Object.fromEntries(await countParquet([file]))).toEqual({ a: 1, b: 2, c: 3, d: 1, e: 1 })
  })

  it('streams a shard over HTTP by byte ranges, so nothing is saved to disk (licence review, question 8)', async () => {
    const file = join(tmp(), 'shard.parquet')
    await parquetWriteFile({ filename: file, columnData: [{ name: 'text', data: ['one two', 'two', 'three three three'], type: 'STRING' }], rowGroupSize: 2 })
    const bytes = readFileSync(file)
    const ranges: string[] = []
    // A minimal range-capable server, as Hugging Face's file hosting is: HEAD gives the size, GET honours Range.
    const server: Server = createServer((req, res) => {
      const range = /bytes=(\d+)-(\d+)?/.exec(req.headers.range ?? '')
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'content-length': bytes.length, 'accept-ranges': 'bytes' })
        return res.end()
      }
      if (!range) return res.writeHead(200, { 'content-length': bytes.length }).end(bytes)
      ranges.push(range[0])
      const start = Number(range[1])
      const end = range[2] === undefined ? bytes.length - 1 : Number(range[2])
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': end - start + 1 })
      res.end(bytes.subarray(start, end + 1))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/shard.parquet`
      const texts: string[] = []
      for await (const t of parquetTexts(url)) texts.push(t)
      expect(texts).toEqual(['one two', 'two', 'three three three'])
      expect(ranges.length).toBeGreaterThan(0)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('keeps the word table bounded by dropping rare forms, while frequent ones keep their counts', async () => {
    const file = join(tmp(), 'shard.parquet')
    const rare = Array.from({ length: 40 }, (_, i) => `rare${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`)
    await parquetWriteFile({ filename: file, columnData: [{ name: 'text', data: ['the the the', ...rare, 'the cat cat'], type: 'STRING' }] })
    const counts = await countParquet([file], undefined, { maxForms: 10 })
    expect(counts.size).toBeLessThanOrEqual(10)
    expect(counts.get('the')).toBe(4)
    expect(counts.get('cat')).toBe(2)
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
  it('adds up the years asked for, folds case, and skips part-of-speech tagged forms', async () => {
    const file = join(tmp(), '1-00000-of-00004.gz')
    const lines = ['Water\t1999,5,1\t2000,3,1\t2019,4,2\t2020,9,9', 'water\t2010,1,1', 'water_NOUN\t2005,100,1', 'the\t2005,10,1', 'old\t1990,7,1']
    writeFileSync(file, gzipSync(`${lines.join('\n')}\n`))
    expect(Object.fromEntries(await sumGoogleBooks([file], 2000, 2019))).toEqual({ water: 8, the: 10 })
  })

  it('streams a file over HTTP, decompressing and counting as it arrives, so nothing is saved to disk', async () => {
    const body = gzipSync('Water\t2000,3,1\t2019,4,2\nthe\t2005,10,1\n')
    // The whole file in small chunks, as a slow download would bring it.
    const server: Server = createServer((req, res) => {
      if (req.url === '/broken.gz') {
        // Half the file, then the connection drops.
        res.writeHead(200, { 'content-length': body.length })
        res.write(body.subarray(0, body.length >> 1))
        return void res.destroy()
      }
      if (req.url !== '/1-00000-of-00004.gz') return res.writeHead(404).end()
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      for (let i = 0; i < body.length; i += 7) res.write(body.subarray(i, i + 7))
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const seen: [string, number][] = []
      const counts = await sumGoogleBooks([`${base}/1-00000-of-00004.gz`], 2000, 2019, (source, lines) => seen.push([source, lines]))
      expect(Object.fromEntries(counts)).toEqual({ water: 7, the: 10 })
      expect(seen).toEqual([[`${base}/1-00000-of-00004.gz`, 2]])
      await expect(sumGoogleBooks([`${base}/missing.gz`], 2000, 2019)).rejects.toThrow(/HTTP 404/)
      await expect(sumGoogleBooks([`${base}/broken.gz`], 2000, 2019)).rejects.toThrow()
      await expect(sumGoogleBooks([join(tmp(), 'absent.gz')], 2000, 2019)).rejects.toThrow(/ENOENT/)
    } finally {
      await new Promise((resolve) => server.close(resolve))
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
