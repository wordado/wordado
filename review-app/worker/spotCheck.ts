import type { RowView } from '../server/types'
import type { SampleRef, SpotCheckResult } from '../shared/hosted'
import type { DecisionRow } from './db'

/**
 * What a spot check may draw (spec §15): a row the AI review passed with no objection at all (a minor one would
 * steer the reviewer), that no learner reported, whose file is not older than the draft, and that holds no verdict
 * yet (one written into the file outside this app: the sample measures rows nobody has judged).
 */
export const eligible = (r: RowView): boolean => r.ai === 'passed' && r.severity === null && r.objections.length === 0 && r.reports === '' && !r.stale && r.decided === null

/** The level a row is counted under, as the row list shows it; '' for a row without one. */
export const levelOf = (r: RowView): string => r.context['level'] ?? ''

/** mulberry32: a small generator that gives the same numbers in [0, 1) for the same seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** `n` shared out over groups of the given sizes as equally as they allow: the remainder goes to the first groups,
 * and what a group is too small to take is shared out among the others the same way. */
export function shares(sizes: readonly number[], n: number): number[] {
  const out = sizes.map(() => 0)
  let left = Math.min(Math.max(0, n), sizes.reduce((sum, s) => sum + s, 0))
  let open = sizes.map((_, i) => i)
  // The groups too small for an equal share give all they have; the share of the others grows, so look again.
  for (;;) {
    const each = Math.floor(left / Math.max(1, open.length))
    const small = open.filter((i) => sizes[i]! <= each)
    if (small.length === 0) break
    for (const i of small) {
      out[i] = sizes[i]!
      left -= sizes[i]!
    }
    open = open.filter((i) => !small.includes(i))
  }
  const each = Math.floor(left / Math.max(1, open.length))
  const extra = left % Math.max(1, open.length)
  open.forEach((i, at) => (out[i] = each + (at < extra ? 1 : 0)))
  return out
}

/**
 * A spot check's sample: up to `n` of the eligible rows, spread evenly over their levels (in the levels' order),
 * drawn and then mixed with a generator seeded by `seed`, so the same rows and seed give the same sample in the
 * same order. `taken` names rows to leave out by `key` (decided elsewhere already). All of them when fewer than `n`
 * qualify.
 */
export function drawSample(rows: readonly RowView[], n: number, seed: number, taken: (row: RowView) => boolean = () => false): SampleRef[] {
  const random = seeded(seed)
  const byLevel = new Map<string, RowView[]>()
  // In an order of their own, so the draw does not depend on the order the files were read in.
  const pool = rows.filter((r) => eligible(r) && !taken(r)).sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
  for (const r of pool) byLevel.set(levelOf(r), [...(byLevel.get(levelOf(r)) ?? []), r])
  const levels = [...byLevel.keys()].sort()
  const take = shares(levels.map((l) => byLevel.get(l)!.length), n)
  const drawn = levels.flatMap((l, i) => shuffled(byLevel.get(l)!, random).slice(0, take[i]))
  return shuffled(drawn, random).map((r) => ({ file: r.file, key: r.key }))
}

/**
 * What a spot check found (spec §15), from the sample, its rows still in the snapshot and the assignment's
 * decisions, submitted or not. A decision on a row that changed since does not count; nor does an unsubmitted one
 * on a row that is gone. A submitted one on a row that is gone does: a merged row leaves the review files.
 */
export function spotCheckResult(sample: readonly SampleRef[], rows: readonly RowView[], decisions: readonly DecisionRow[]): SpotCheckResult {
  const hash = new Map(rows.map((r) => [r.key, r.rowHash]))
  const byKey = new Map(decisions.map((d) => [d.key, d]))
  let fine = 0
  let minor = 0
  const seriousKeys: string[] = []
  let checked = 0
  for (const { key } of sample) {
    const d = byKey.get(key)
    if (!d) continue
    const now = hash.get(key)
    if (now === undefined ? d.submission === null : now !== d.rowHash) continue
    checked += 1
    // A change always carries a severity (the decision route sees to it); one without is counted as minor, not lost.
    if (d.severity === 'major') seriousKeys.push(key)
    else if (d.severity === 'minor' || d.action !== 'keep') minor += 1
    else fine += 1
  }
  return { checked, fine, minor, serious: seriousKeys.length, seriousKeys }
}
