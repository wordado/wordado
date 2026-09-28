import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { contentPaths } from './content'
import { readJson } from './files'

/**
 * One frequency list in the licence register (Decision 3). "Open" does not
 * mean "commercially usable" (spec §5.4): each source is cleared by the legal
 * review (§15) before the pipeline will read it.
 */
export interface SourceRecord {
  readonly id: string
  /** A file name inside `sources/`: "form<TAB>count" per line. */
  readonly file: string
  readonly title: string
  readonly url: string
  /** The licence as its publisher states it, e.g. an SPDX identifier. */
  readonly licence: string
  readonly commercial_use: boolean
  readonly share_alike: boolean
  /** Attribution the licence requires; shown in the app when non-empty (release.json). */
  readonly attribution: string
  readonly cleared_by: string
  readonly cleared_on: string
  readonly notes: string
}

export class LicenceError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`The licence register stops this run (spec §5.4):\n${problems.join('\n')}`)
    this.name = 'LicenceError'
    this.problems = problems
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function licenceProblems(r: SourceRecord): string[] {
  const p: string[] = []
  if (r.commercial_use !== true) p.push(`${r.id}: does not permit commercial use`)
  if (r.share_alike !== false) p.push(`${r.id}: is share-alike, which would bind the corpus`)
  if (!r.cleared_by?.trim() && !r.cleared_on?.trim()) p.push(`${r.id}: not cleared by the legal review (cleared_by and cleared_on are empty)`)
  else if (!r.cleared_by?.trim()) p.push(`${r.id}: not cleared by the legal review (cleared_by is empty)`)
  else if (!DATE.test(r.cleared_on ?? '')) p.push(`${r.id}: cleared_on must be YYYY-MM-DD`)
  return p
}

/**
 * Every source's text, or nothing: one uncleared source stops the whole run
 * before any file is read, so an uncleared list can never leak into a corpus
 * built "just to try" (Review Focus 4).
 */
export function readClearedSources(dir: string): { record: SourceRecord; text: string }[] {
  const paths = contentPaths(dir)
  const records = readJson<SourceRecord[]>(paths.sources)
  if (!Array.isArray(records) || records.length === 0) throw new LicenceError(['sources.json lists no sources'])
  const problems: string[] = []
  for (const r of records) {
    problems.push(...licenceProblems(r))
    if (typeof r.file !== 'string' || basename(r.file) !== r.file) problems.push(`${r.id}: file must be a name inside sources/`)
    else if (!existsSync(join(paths.sourcesDir, r.file))) problems.push(`${r.id}: sources/${r.file} is missing`)
  }
  if (problems.length > 0) throw new LicenceError(problems)
  return records.map((record) => ({ record, text: readFileSync(join(paths.sourcesDir, record.file), 'utf8') }))
}
