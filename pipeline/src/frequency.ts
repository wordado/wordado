import { norm } from '@wordado/core'

/** A word as a learner types it: letters (any script's Latin letters with diacritics), apostrophes, hyphens. */
const WORD = /^\p{Ll}[\p{Ll}'’-]*$/u

/**
 * A frequency list: "form<TAB>count" (or a space) per line. Comments (#),
 * blank lines and a non-numeric header line are skipped; tokens that are not
 * words are dropped. Forms that meet after normalising are summed.
 */
export function parseFrequencyList(text: string, sourceId: string): Map<string, number> {
  const out = new Map<string, number>()
  let data = false
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return
    const [rawForm, rawCount] = trimmed.split(/[\t ]+/)
    if (rawForm === undefined || rawCount === undefined) return
    // A non-numeric count before any data is the header line.
    if (!data && !/^\d+$/.test(rawCount)) return
    data = true
    if (!/^\d+$/.test(rawCount) || Number(rawCount) < 1) throw new Error(`${sourceId}:${i + 1}: count must be a positive integer`)
    const form = norm(rawForm).replaceAll('’', "'")
    if (!WORD.test(form)) return
    out.set(form, (out.get(form) ?? 0) + Number(rawCount))
  })
  return out
}

export interface RankedForm {
  readonly form: string
  readonly perMillion: number
  /** 1-based. */
  readonly rank: number
}

/** Merges lists by their mean per-million rate (a list without the form counts zero) and ranks the result. */
export function rankForms(lists: readonly ReadonlyMap<string, number>[], max: number): RankedForm[] {
  const sums = new Map<string, number>()
  for (const list of lists) {
    let total = 0
    for (const count of list.values()) total += count
    if (total === 0) continue
    for (const [form, count] of list) sums.set(form, (sums.get(form) ?? 0) + (count / total) * 1e6)
  }
  return [...sums]
    .map(([form, sum]) => ({ form, perMillion: Math.round(sum / lists.length) }))
    .sort((a, b) => b.perMillion - a.perMillion || (a.form < b.form ? -1 : a.form > b.form ? 1 : 0))
    .slice(0, max)
    .map((f, i) => ({ ...f, rank: i + 1 }))
}
