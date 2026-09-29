import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { norm } from '@wordado/core'
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet'

/** A running word: letters, with apostrophes inside (don't). Hyphens and digits split words. */
const TOKEN = /\p{L}+(?:['’]\p{L}+)*/gu

/** Adds a text's word forms to `counts`, normalised as parseFrequencyList normalises them (Task 3). */
export function countInto(counts: Map<string, number>, text: string): void {
  // One normalisation per text rather than per token: this runs over billions of tokens.
  for (const [token] of text.normalize('NFC').toLowerCase().matchAll(TOKEN)) {
    const form = token.includes('’') ? token.replaceAll('’', "'") : token
    counts.set(form, (counts.get(form) ?? 0) + 1)
  }
}

/**
 * Counting only ever streams (licence review, question 8): a source is an http(s) URL, read over the network, and
 * only the counts are kept. A local file is refused, so no downloaded copy of a corpus is ever counted, or kept.
 */
export function streamed(sources: readonly string[]): void {
  for (const source of sources) {
    if (!/^https?:\/\//.test(source)) {
      throw new Error(`${source}: counting reads only http(s) URLs, streamed and never saved; to try a local file, serve it over HTTP`)
    }
  }
}

/**
 * One Parquet file's text column, a row group at a time, read by byte ranges from its URL into memory, so a 2 GB
 * shard never sits in memory whole and nothing of its web text is written to disk.
 */
export async function* parquetTexts(source: string, column = 'text'): AsyncGenerator<string> {
  streamed([source])
  const buffer = await asyncBufferFromUrl({ url: source })
  const metadata = await parquetMetadataAsync(buffer)
  let rowStart = 0
  for (const group of metadata.row_groups) {
    const rowEnd = rowStart + Number(group.num_rows)
    const rows = (await parquetReadObjects({ file: buffer, metadata, columns: [column], rowStart, rowEnd })) as Record<string, unknown>[]
    for (const row of rows) {
      const text = row[column]
      if (typeof text === 'string') yield text
    }
    rowStart = rowEnd
  }
}

/**
 * The word table's size limit. Billions of tokens of web text hold tens of millions of distinct forms, most seen
 * once, which outgrow Node's default heap; 12 million entries stay well inside it.
 */
export const MAX_FORMS = 12_000_000

/**
 * Drops the rarest forms, raising the floor (seen once, then twice, …) until at most half of `max` remain, so the
 * next pruning is far off. A pruned form that comes back starts again from zero, which costs it at most the floor
 * per pruning: nothing for the 200,000 most frequent forms of a corpus this size, whose counts run to hundreds.
 */
export function pruneRare(counts: Map<string, number>, max: number): void {
  for (let floor = 1; counts.size > max / 2; floor += 1) {
    for (const [form, n] of counts) if (n <= floor) counts.delete(form)
  }
}

export async function countParquet(
  sources: readonly string[],
  progress?: (source: string, texts: number) => void,
  opts: { maxForms?: number } = {},
): Promise<Map<string, number>> {
  streamed(sources)
  const maxForms = opts.maxForms ?? MAX_FORMS
  const counts = new Map<string, number>()
  for (const file of sources) {
    let texts = 0
    for await (const text of parquetTexts(file)) {
      countInto(counts, text)
      if (counts.size > maxForms) pruneRare(counts, maxForms)
      texts += 1
      if (progress && texts % 100_000 === 0) progress(file, texts)
    }
    progress?.(file, texts)
  }
  return counts
}

/** A gzip file's bytes from its URL, read as it downloads and never saved. */
async function gzipSource(source: string): Promise<Readable> {
  const res = await fetch(source)
  if (!res.ok || !res.body) throw new Error(`${source}: HTTP ${res.status}`)
  return Readable.fromWeb(res.body as WebReadableStream<Uint8Array>)
}

/**
 * Google Books Ngram v3 1-grams: `ngram TAB year,match_count,volume_count TAB …`.
 * Adds up `match_count` for years `from`–`to` (the pilot used 2000–2019, so the
 * counts reflect current usage), folds case, and skips part-of-speech tagged
 * forms (`water_NOUN`), which would count a word twice. Each source is a URL,
 * decompressed and counted as it streams in; only the counts are kept.
 */
export async function sumGoogleBooks(
  sources: readonly string[],
  from: number,
  to: number,
  progress?: (source: string, lines: number) => void,
): Promise<Map<string, number>> {
  streamed(sources)
  const counts = new Map<string, number>()
  for (const source of sources) {
    const raw = await gzipSource(source)
    const gunzip = createGunzip()
    // pipe() does not pass a source's error on: a broken download must fail the loop below.
    raw.on('error', (err) => gunzip.destroy(err))
    const lines = createInterface({ input: raw.pipe(gunzip), crlfDelay: Infinity })
    let read = 0
    for await (const line of lines) {
      read += 1
      const [ngram, ...cells] = line.split('\t')
      if (!ngram || ngram.includes('_')) continue
      let n = 0
      for (const cell of cells) {
        const [year, match] = cell.split(',')
        const y = Number(year)
        if (y >= from && y <= to) n += Number(match)
      }
      if (n === 0) continue
      const form = norm(ngram)
      counts.set(form, (counts.get(form) ?? 0) + n)
    }
    progress?.(source, read)
  }
  return counts
}

/** The pipeline's input format (`form<TAB>count`, a comment, a header), most frequent first. Returns the rows written. */
export function writeCounts(file: string, counts: ReadonlyMap<string, number>, opts: { top?: number; comment: string }): number {
  const rows = [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, opts.top ?? 200_000)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `# ${opts.comment}\nform\tcount\n${rows.map(([form, n]) => `${form}\t${n}`).join('\n')}\n`)
  return rows.length
}
