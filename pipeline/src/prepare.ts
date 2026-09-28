import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { norm } from '@wordado/core'
import { asyncBufferFromFile, asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet'

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
 * One Parquet file's text column, a row group at a time, so a 2 GB shard never sits in memory whole. A source is a
 * path or an http(s) URL. A URL is read by byte ranges into memory and never saved: counting FineWeb this way keeps
 * no copy of its web text on disk (licence review, question 8).
 */
export async function* parquetTexts(source: string, column = 'text'): AsyncGenerator<string> {
  const buffer = /^https?:\/\//.test(source) ? await asyncBufferFromUrl({ url: source }) : await asyncBufferFromFile(source)
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

/**
 * Google Books Ngram v3 1-grams: `ngram TAB year,match_count,volume_count TAB …`.
 * Adds up `match_count` for years `from`–`to` (the pilot used 2000–2019, so the
 * counts reflect current usage), folds case, and skips part-of-speech tagged
 * forms (`water_NOUN`), which would count a word twice.
 */
export async function sumGoogleBooks(files: readonly string[], from: number, to: number): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (const file of files) {
    const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })
    for await (const line of lines) {
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
