import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { parquetWriteFile } from 'hyparquet-writer'
import { describe, expect, it } from 'vitest'
import { parseFrequencyList } from './frequency'
import { countInto, countParquet, parquetTexts, sumGoogleBooks, writeCounts } from './prepare'

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
})

describe('sumGoogleBooks', () => {
  it('adds up the years asked for, folds case, and skips part-of-speech tagged forms', async () => {
    const file = join(tmp(), '1-00000-of-00004.gz')
    const lines = ['Water\t1999,5,1\t2000,3,1\t2019,4,2\t2020,9,9', 'water\t2010,1,1', 'water_NOUN\t2005,100,1', 'the\t2005,10,1', 'old\t1990,7,1']
    writeFileSync(file, gzipSync(`${lines.join('\n')}\n`))
    expect(Object.fromEntries(await sumGoogleBooks([file], 2000, 2019))).toEqual({ water: 8, the: 10 })
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
