import type { SplitProposal } from '../shared/hosted'

export function filesOverlap(a: readonly string[] | '*', b: readonly string[] | '*'): boolean {
  if (a === '*' || b === '*') return true
  return a.some((f) => b.includes(f))
}

/** What the overlap rule needs of an assignment: its files, and what it takes of them. */
export interface Coverage {
  readonly files: readonly string[] | '*'
  readonly flaggedOnly: boolean
  readonly spotCheck: boolean
}

/**
 * Whether two open assignments of one queue cannot both stand (spec §5 and §15). Two assignments of files clash
 * when they share a file. A spot check samples rows the AI review passed, so it shares no row with a flagged-only
 * assignment and stands beside one; it clashes with an all-rows assignment that shares a file with it, and with
 * any other spot check of the queue.
 */
export function clashes(a: Coverage, b: Coverage): boolean {
  if (a.spotCheck && b.spotCheck) return true
  if (a.spotCheck || b.spotCheck) return !(a.spotCheck ? b : a).flaggedOnly && filesOverlap(a.files, b.files)
  return filesOverlap(a.files, b.files)
}

export class SplitError extends Error {}

/** Whole files dealt out heaviest first, each to the reviewer with the least so far (spec §5, "Splitting a queue"). */
export function proposeSplit(files: readonly { file: string; weight: number }[], reviewers: readonly string[]): SplitProposal[] {
  if (reviewers.length < 2) throw new SplitError('pick two or more reviewers to split between')
  if (files.length < reviewers.length) throw new SplitError(`only ${files.length} free files for ${reviewers.length} reviewers`)
  const parts = reviewers.map((reviewer) => ({ reviewer, files: [] as string[], rows: 0 }))
  for (const f of [...files].sort((x, y) => y.weight - x.weight || x.file.localeCompare(y.file))) {
    const least = parts.reduce((m, p) => (p.rows < m.rows ? p : m))
    least.files.push(f.file)
    least.rows += f.weight
  }
  return parts.map((p) => ({ reviewer: p.reviewer, files: p.files.sort(), rows: p.rows }))
}
