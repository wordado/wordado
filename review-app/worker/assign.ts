import type { SplitProposal } from '../shared/hosted'

export function filesOverlap(a: readonly string[] | '*', b: readonly string[] | '*'): boolean {
  if (a === '*' || b === '*') return true
  return a.some((f) => b.includes(f))
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
